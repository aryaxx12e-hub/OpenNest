// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createUser, openAuthDatabase, type AuthDatabase } from "../../auth/auth-db";
import { addMembership } from "../../auth/membership";
import { createSession, setSessionCsrf } from "../../auth/session";
import { createCsrfChallenge } from "../../http/csrf";
import { createRouter } from "../../http/router";
import { openMcpAuth, type McpAuth } from "../auth";
import { registerMcpTokenRoutes } from "../../routes/mcp-tokens";

const NOW = new Date("2026-11-19T08:00:00.000Z");
const WORKSPACE_ID = "workspace-1";
const roots: string[] = [];
const databases: AuthDatabase[] = [];
const servers: Server[] = [];

interface TestServer {
  auth: AuthDatabase;
  mcp: McpAuth;
  base: string;
  ownerCookie: string;
  ownerCsrf: string;
  editorCookie: string;
  editorCsrf: string;
}

async function sessionFor(
  auth: AuthDatabase,
  userId: string
): Promise<{ cookie: string; csrf: string }> {
  const session = createSession(auth, userId, NOW);
  const challenge = createCsrfChallenge();
  setSessionCsrf(auth, session.session.id, challenge.hash);

  return {
    cookie: `opennest_session=${session.token}; opennest_csrf=${challenge.token}`,
    csrf: challenge.token,
  };
}

async function setup(): Promise<TestServer> {
  const root = await mkdtemp(path.join(tmpdir(), "opennest-mcp-routes-"));
  roots.push(root);
  const auth = openAuthDatabase({ databaseFile: path.join(root, "auth.sqlite") });
  databases.push(auth);
  const owner = createUser(auth, {
    email: "owner@example.com",
    digest: { hash: "a".repeat(64), salt: "b".repeat(32) },
    now: NOW,
  });
  addMembership(auth, owner.id, "owner", NOW);
  const editor = createUser(auth, {
    email: "editor@example.com",
    digest: { hash: "c".repeat(64), salt: "d".repeat(32) },
    now: NOW,
  });
  addMembership(auth, editor.id, "editor", NOW);
  const mcp = openMcpAuth(auth);
  const ownerSession = await sessionFor(auth, owner.id);
  const editorSession = await sessionFor(auth, editor.id);
  const router = createRouter();

  registerMcpTokenRoutes(router, {
    auth,
    mcp,
    workspaceId: async () => WORKSPACE_ID,
    now: () => NOW,
  });

  const server = createServer((request, response) => {
    void router.handle(request, response);
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;

  return {
    auth,
    mcp,
    base: `http://127.0.0.1:${address.port}`,
    ownerCookie: ownerSession.cookie,
    ownerCsrf: ownerSession.csrf,
    editorCookie: editorSession.cookie,
    editorCsrf: editorSession.csrf,
  };
}

function authHeaders(cookie: string, csrf?: string): Record<string, string> {
  return {
    "content-type": "application/json",
    cookie,
    ...(csrf === undefined ? {} : { "x-csrf-token": csrf }),
  };
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        })
    )
  );
  for (const database of databases.splice(0)) {
    database.close();
  }
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("MCP token routes", () => {
  it("lets an owner create a token once and list only safe metadata", async () => {
    const test = await setup();
    const created = await fetch(`${test.base}/api/mcp/tokens`, {
      method: "POST",
      headers: authHeaders(test.ownerCookie, test.ownerCsrf),
      body: JSON.stringify({ name: "Laptop" }),
    });
    const body = (await created.json()) as {
      token: string;
      record: { id: string; prefix: string };
    };

    expect(created.status).toBe(201);
    expect(body.token).toMatch(/^onmcp_/);
    expect(body.record).toMatchObject({ prefix: body.token.slice(0, 16) });

    const listed = await fetch(`${test.base}/api/mcp/tokens`, {
      headers: { cookie: test.ownerCookie },
    });
    const listBody = (await listed.json()) as { tokens: unknown[] };

    expect(listed.status).toBe(200);
    expect(listBody.tokens).toHaveLength(1);
    expect(JSON.stringify(listBody)).not.toContain(body.token);
    expect(JSON.stringify(listBody)).toContain(body.record.prefix);
  });

  it("requires an owner session and CSRF for token mutation", async () => {
    const test = await setup();
    const anonymous = await fetch(`${test.base}/api/mcp/tokens`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const editor = await fetch(`${test.base}/api/mcp/tokens`, {
      method: "POST",
      headers: authHeaders(test.editorCookie, test.editorCsrf),
      body: JSON.stringify({}),
    });
    const noCsrf = await fetch(`${test.base}/api/mcp/tokens`, {
      method: "POST",
      headers: authHeaders(test.ownerCookie),
      body: JSON.stringify({}),
    });

    expect(anonymous.status).toBe(401);
    expect(editor.status).toBe(403);
    expect(noCsrf.status).toBe(403);
  });

  it("revokes a token and refuses a second revoke", async () => {
    const test = await setup();
    const created = test.mcp.createToken({
      workspaceId: WORKSPACE_ID,
      createdBy: (
        test.auth.sqlite
          .prepare("SELECT id FROM users WHERE email = ?")
          .get("owner@example.com") as { id: string }
      ).id,
      now: NOW,
    });
    const revoke = await fetch(`${test.base}/api/mcp/tokens/${created.record.id}`, {
      method: "DELETE",
      headers: authHeaders(test.ownerCookie, test.ownerCsrf),
    });
    const again = await fetch(`${test.base}/api/mcp/tokens/${created.record.id}`, {
      method: "DELETE",
      headers: authHeaders(test.ownerCookie, test.ownerCsrf),
    });
    const listed = await fetch(`${test.base}/api/mcp/tokens`, {
      headers: { cookie: test.ownerCookie },
    });
    const body = (await listed.json()) as {
      tokens: Array<{ id: string; revokedAt: string | null }>;
    };

    expect(revoke.status).toBe(204);
    expect(again.status).toBe(404);
    expect(body.tokens[0]?.revokedAt).toBe(NOW.toISOString());
    expect(test.mcp.resolveToken(created.token, NOW)).toBeNull();
  });

  it("validates the create body and workspace availability", async () => {
    const test = await setup();
    const invalidName = await fetch(`${test.base}/api/mcp/tokens`, {
      method: "POST",
      headers: authHeaders(test.ownerCookie, test.ownerCsrf),
      body: JSON.stringify({ name: "x".repeat(81) }),
    });
    const extra = await fetch(`${test.base}/api/mcp/tokens`, {
      method: "POST",
      headers: authHeaders(test.ownerCookie, test.ownerCsrf),
      body: JSON.stringify({ admin: true }),
    });

    expect(invalidName.status).toBe(400);
    expect(extra.status).toBe(400);
  });
});
