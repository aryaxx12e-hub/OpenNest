// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createAuditLog, type AuditLog } from "../../audit/audit-log";
import { openAuthDatabase, type AuthDatabase } from "../../auth/auth-db";
import { bootstrapOwner } from "../../auth/membership";
import { registerAuthRoutes } from "../auth";
import { registerBootstrapRoutes } from "../bootstrap";
import { registerMembershipRoutes } from "../membership";
import { createRateLimiter } from "../../http/rate-limit";
import { createRouter } from "../../http/router";

const PASSWORD = "correct horse battery staple";
const NOW = new Date("2026-11-18T10:00:00.000Z");
const roots: string[] = [];
const databases: AuthDatabase[] = [];
const servers: Server[] = [];

interface MembershipTestServer {
  base: string;
  auth: AuthDatabase;
  audit: AuditLog;
  ownerId: string | null;
  clock: { now: Date };
}

interface Session {
  cookie: string;
  csrfToken: string;
}

async function startMembershipServer(withOwner = true): Promise<MembershipTestServer> {
  const root = await mkdtemp(path.join(tmpdir(), "opennest-membership-routes-"));
  roots.push(root);
  const auth = openAuthDatabase({
    databaseFile: path.join(root, "auth.sqlite"),
  });
  databases.push(auth);
  const audit = createAuditLog(auth);
  const clock = { now: NOW };
  let ownerId: string | null = null;

  if (withOwner) {
    const owner = await bootstrapOwner(
      auth,
      { email: "owner@example.com", password: PASSWORD },
      NOW,
      audit
    );
    ownerId = owner.user.id;
  }

  const router = createRouter();

  registerAuthRoutes(router, {
    auth,
    rateLimiter: createRateLimiter({
      limit: 20,
      windowMs: 60_000,
      now: () => clock.now,
    }),
    now: () => clock.now,
  });
  registerBootstrapRoutes(router, { auth });
  registerMembershipRoutes(router, {
    auth,
    audit,
    now: () => clock.now,
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
    base: `http://127.0.0.1:${address.port}`,
    auth,
    audit,
    ownerId,
    clock,
  };
}

function cookieLines(response: Response): string[] {
  return response.headers.getSetCookie();
}

function cookiePair(line: string): string {
  return line.split(";")[0] ?? "";
}

function cookieHeader(response: Response): string {
  return cookieLines(response).map(cookiePair).join("; ");
}

async function login(base: string): Promise<Session> {
  const response = await fetch(`${base}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "owner@example.com", password: PASSWORD }),
  });
  const body = (await response.json()) as { csrfToken: string };

  expect(response.status).toBe(200);

  return {
    cookie: cookieHeader(response),
    csrfToken: body.csrfToken,
  };
}

function ownerHeaders(session: Session): Record<string, string> {
  return {
    "content-type": "application/json",
    cookie: session.cookie,
    "x-csrf-token": session.csrfToken,
  };
}

async function inviteViewer(
  base: string,
  owner: Session,
  email = "viewer@example.com"
): Promise<{ token: string; inviteId: string }> {
  const response = await fetch(`${base}/auth/invites`, {
    method: "POST",
    headers: ownerHeaders(owner),
    body: JSON.stringify({ email, role: "viewer" }),
  });
  const body = (await response.json()) as {
    token: string;
    invite: { id: string };
  };

  expect(response.status).toBe(201);

  return { token: body.token, inviteId: body.invite.id };
}

async function acceptInvite(
  base: string,
  token: string
): Promise<{ response: Response; body: Record<string, unknown> }> {
  const response = await fetch(`${base}/auth/invites/accept`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, password: "viewer password is long" }),
  });

  return {
    response,
    body: (await response.json()) as Record<string, unknown>,
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

describe("bootstrap route", () => {
  it("is public only until the first owner exists", async () => {
    const server = await startMembershipServer(false);
    const before = await fetch(`${server.base}/auth/bootstrap`);

    expect(before.status).toBe(200);
    await expect(before.json()).resolves.toEqual({ status: "required" });

    await bootstrapOwner(
      server.auth,
      { email: "owner@example.com", password: PASSWORD },
      NOW,
      server.audit
    );

    const after = await fetch(`${server.base}/auth/bootstrap`);
    expect(after.status).toBe(404);
    await expect(after.json()).resolves.toEqual({
      error: { code: "not_found", message: "The requested path was not found." },
    });
  });
});

describe("membership routes", () => {
  it("lets only an owner invite, change roles, and revoke", async () => {
    const server = await startMembershipServer();
    const owner = await login(server.base);
    const invite = await inviteViewer(server.base, owner);
    const accepted = await acceptInvite(server.base, invite.token);
    const viewerId = (accepted.body.user as { id: string }).id;
    const viewerResponse = accepted.response;
    const viewer: Session = {
      cookie: cookieHeader(viewerResponse),
      csrfToken: accepted.body.csrfToken as string,
    };

    expect(accepted.response.status).toBe(201);

    const forbiddenInvite = await fetch(`${server.base}/auth/invites`, {
      method: "POST",
      headers: ownerHeaders(viewer),
      body: JSON.stringify({ email: "other@example.com", role: "viewer" }),
    });
    expect(forbiddenInvite.status).toBe(403);

    const forbiddenPromotion = await fetch(`${server.base}/auth/members/${viewerId}`, {
      method: "PATCH",
      headers: ownerHeaders(viewer),
      body: JSON.stringify({ role: "editor" }),
    });
    expect(forbiddenPromotion.status).toBe(403);

    const forbiddenRevoke = await fetch(`${server.base}/auth/members/${server.ownerId}`, {
      method: "DELETE",
      headers: ownerHeaders(viewer),
    });
    expect(forbiddenRevoke.status).toBe(403);

    const members = await fetch(`${server.base}/auth/members`, {
      headers: { cookie: owner.cookie },
    });
    const memberBody = (await members.json()) as { members: unknown[] };
    expect(memberBody.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: server.ownerId, role: "owner" }),
        expect.objectContaining({ userId: viewerId, role: "viewer" }),
      ])
    );
  });

  it("accepts an invite exactly once and creates one member", async () => {
    const server = await startMembershipServer();
    const owner = await login(server.base);
    const invite = await inviteViewer(server.base, owner);
    const first = await acceptInvite(server.base, invite.token);

    expect(first.response.status).toBe(201);
    expect(first.body.user).toMatchObject({
      email: "viewer@example.com",
      role: "viewer",
    });
    expect(cookieLines(first.response)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("opennest_session="),
        expect.stringContaining("opennest_csrf="),
      ])
    );

    const second = await acceptInvite(server.base, invite.token);
    expect(second.response.status).toBe(400);
    expect(second.body).toEqual({
      error: {
        code: "invite_used",
        message: "The invite has already been used.",
      },
    });

    const members = await fetch(`${server.base}/auth/members`, {
      headers: { cookie: owner.cookie },
    });
    const body = (await members.json()) as { members: unknown[] };
    expect(body.members).toHaveLength(2);
  });

  it("protects the last owner from demotion and revocation", async () => {
    const server = await startMembershipServer();
    const owner = await login(server.base);

    const demote = await fetch(`${server.base}/auth/members/${server.ownerId}`, {
      method: "PATCH",
      headers: ownerHeaders(owner),
      body: JSON.stringify({ role: "viewer" }),
    });

    expect(demote.status).toBe(409);
    await expect(demote.json()).resolves.toMatchObject({
      error: { code: "last_owner" },
    });

    const revoke = await fetch(`${server.base}/auth/members/${server.ownerId}`, {
      method: "DELETE",
      headers: ownerHeaders(owner),
    });

    expect(revoke.status).toBe(409);
    await expect(revoke.json()).resolves.toMatchObject({
      error: { code: "last_owner" },
    });

    const members = await fetch(`${server.base}/auth/members`, {
      headers: { cookie: owner.cookie },
    });
    const body = (await members.json()) as { members: unknown[] };
    expect(body.members).toHaveLength(1);
  });

  it("requires a session to list members", async () => {
    const server = await startMembershipServer();
    const response = await fetch(`${server.base}/auth/members`);

    expect(response.status).toBe(401);
  });

  it("audits membership changes without storing secrets or content", async () => {
    const server = await startMembershipServer();
    const owner = await login(server.base);
    const invite = await inviteViewer(server.base, owner);
    const accepted = await acceptInvite(server.base, invite.token);
    const viewerId = (accepted.body.user as { id: string }).id;

    const promoted = await fetch(`${server.base}/auth/members/${viewerId}`, {
      method: "PATCH",
      headers: ownerHeaders(owner),
      body: JSON.stringify({ role: "editor" }),
    });
    expect(promoted.status).toBe(200);

    const revoked = await fetch(`${server.base}/auth/members/${viewerId}`, {
      method: "DELETE",
      headers: ownerHeaders(owner),
    });
    expect(revoked.status).toBe(204);

    const records = server.audit.list();
    expect(records.map((record) => record.action)).toEqual([
      "bootstrap.owner",
      "member.invite",
      "member.accept",
      "member.role_change",
      "member.revoke",
    ]);

    const raw = JSON.stringify(
      server.auth.sqlite.prepare("SELECT * FROM audit_log").all()
    );
    const password = "viewer password is long";

    expect(raw).not.toContain(invite.token);
    expect(raw).not.toContain(password);
    expect(raw).not.toContain("private note text");
  });
});
