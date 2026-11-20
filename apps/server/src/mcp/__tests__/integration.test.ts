// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createSqliteStorage } from "@opennest/storage-sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { createAuditLog } from "../../audit/audit-log";
import { openAuthDatabase } from "../../auth/auth-db";
import { bootstrapOwner } from "../../auth/membership";
import type { ServerConfig } from "../../config";
import { startServer, type RunningServer } from "../../index";

const NOW = new Date("2026-11-19T08:00:00.000Z");
const PASSWORD = "correct horse battery staple";
const roots: string[] = [];
const running: RunningServer[] = [];

function configFor(root: string): ServerConfig {
  return {
    dataDir: root,
    host: "127.0.0.1",
    port: 0,
    publicUrl: "http://127.0.0.1:0",
    workspaceDatabasePath: path.join(root, "workspace.sqlite"),
    authDatabasePath: path.join(root, "auth.sqlite"),
    blobRoot: path.join(root, "blobs"),
    mcpEnabled: true,
  };
}

function cookieHeader(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((line) => line.split(";")[0] ?? "")
    .join("; ");
}

function cookieValue(cookie: string, name: string): string {
  const match = new RegExp(`(?:^|; )${name}=([^;]+)`).exec(cookie);
  return match?.[1] === undefined ? "" : decodeURIComponent(match[1]);
}

afterEach(async () => {
  await Promise.all(running.splice(0).map((server) => server.close()));
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("MCP end-to-end", () => {
  it("creates an owner token and reads a note through the MCP endpoint", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "opennest-mcp-e2e-"));
    roots.push(root);
    const config = configFor(root);
    const seed = createSqliteStorage({
      databaseFile: config.workspaceDatabasePath,
      blobRoot: config.blobRoot,
    });
    await seed.init();
    const at = NOW.toISOString() as never;
    const workspace = await seed.workspaces.ensureWorkspace({
      name: "Main",
      at,
    });
    const note = await seed.notes.create({
      workspaceId: workspace.id,
      folderId: null,
      title: "MCP note",
      content: "Read-only workspace access.",
      at,
    });
    await seed.close();

    const auth = openAuthDatabase({ databaseFile: config.authDatabasePath });
    try {
      await bootstrapOwner(
        auth,
        { email: "owner@example.com", password: PASSWORD },
        NOW,
        createAuditLog(auth)
      );
    } finally {
      auth.close();
    }

    const server = await startServer(config);
    running.push(server);

    const login = await fetch(`http://127.0.0.1:${server.port}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "owner@example.com",
        password: PASSWORD,
      }),
    });
    const cookies = cookieHeader(login);
    const csrf = cookieValue(cookies, "opennest_csrf");

    expect(login.status).toBe(200);

    const created = await fetch(`http://127.0.0.1:${server.port}/api/mcp/tokens`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: cookies,
        "x-csrf-token": csrf,
      },
      body: JSON.stringify({ name: "Integration client" }),
    });
    const createdBody = (await created.json()) as { token: string };

    expect(created.status).toBe(201);
    expect(createdBody.token).toMatch(/^onmcp_/);

    const call = await fetch(`http://127.0.0.1:${server.port}/api/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${createdBody.token}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "read_note", arguments: { noteId: note.id } },
      }),
    });
    const callBody = (await call.json()) as {
      result: { content: Array<{ type: string; text: string }>; isError?: boolean };
    };

    expect(call.status).toBe(200);
    expect(callBody.result.isError).toBeUndefined();
    expect(JSON.parse(callBody.result.content[0]?.text ?? "null")).toMatchObject({
      id: note.id,
      title: "MCP note",
      content: "Read-only workspace access.",
    });
  });
});
