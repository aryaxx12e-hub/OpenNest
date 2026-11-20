// @vitest-environment node

import { stat, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { startServer, type RunningServer } from "../index";
import type { ServerConfig } from "../config";
import { openAuthDatabase } from "../auth/auth-db";
import { bootstrapOwner } from "../auth/membership";

const roots: string[] = [];
const running: RunningServer[] = [];

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "opennest-server-"));
  roots.push(root);
  return root;
}

function configFor(root: string): ServerConfig {
  return {
    dataDir: path.join(root, "data"),
    host: "127.0.0.1",
    port: 0,
    publicUrl: "http://127.0.0.1",
    workspaceDatabasePath: path.join(root, "data", "workspace.sqlite"),
    authDatabasePath: path.join(root, "data", "auth.sqlite"),
    blobRoot: path.join(root, "data", "blobs"),
    mcpEnabled: false,
  };
}

afterEach(async () => {
  await Promise.all(running.splice(0).map((server) => server.close()));
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("server host", () => {
  it("creates the data directory and serves liveness", async () => {
    const root = await makeRoot();
    const config = configFor(root);
    const server = await startServer(config);
    running.push(server);

    const directory = await stat(config.dataDir);
    expect(directory.isDirectory()).toBe(true);

    const response = await fetch(`http://127.0.0.1:${server.port}/health/live`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
    expect(server.port).toBeGreaterThan(0);
  });

  it("creates both databases and reports ready", async () => {
    const root = await makeRoot();
    const config = configFor(root);
    const server = await startServer(config);
    running.push(server);

    const response = await fetch(`http://127.0.0.1:${server.port}/health/ready`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  it("mounts the authenticated sync routes", async () => {
    const root = await makeRoot();
    const server = await startServer(configFor(root));
    running.push(server);

    const response = await fetch(`http://127.0.0.1:${server.port}/api/sync/push`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        protocolVersion: 1,
        workspaceId: "00000000-0000-4000-8000-000000000000",
        operations: [],
      }),
    });

    expect(response.status).toBe(401);
  });

  it("serves login after the owner is bootstrapped", async () => {
    const root = await makeRoot();
    const config = configFor(root);
    const server = await startServer(config);
    running.push(server);

    const auth = openAuthDatabase({ databaseFile: config.authDatabasePath });

    try {
      await bootstrapOwner(auth, {
        email: "owner@example.com",
        password: "correct horse battery staple",
      });
    } finally {
      auth.close();
    }

    const response = await fetch(`http://127.0.0.1:${server.port}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "owner@example.com",
        password: "correct horse battery staple",
      }),
    });

    expect(response.status).toBe(200);
  });

  it("uses an injected readiness check", async () => {
    const root = await makeRoot();
    const server = await startServer(configFor(root), {
      readiness: async () => true,
    });
    running.push(server);

    const response = await fetch(`http://127.0.0.1:${server.port}/health/ready`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  it("keeps MCP routes disabled by default", async () => {
    const root = await makeRoot();
    const server = await startServer(configFor(root));
    running.push(server);

    const endpoint = await fetch(`http://127.0.0.1:${server.port}/api/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    const tokens = await fetch(`http://127.0.0.1:${server.port}/api/mcp/tokens`);

    expect(endpoint.status).toBe(404);
    expect(tokens.status).toBe(404);
  });

  it("mounts authenticated MCP routes only when enabled", async () => {
    const root = await makeRoot();
    const config = configFor(root);
    config.mcpEnabled = true;
    const server = await startServer(config);
    running.push(server);

    const endpoint = await fetch(`http://127.0.0.1:${server.port}/api/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    const tokens = await fetch(`http://127.0.0.1:${server.port}/api/mcp/tokens`);

    expect(endpoint.status).toBe(401);
    expect(tokens.status).toBe(401);
  });

  it("closes idempotently and stops accepting requests", async () => {
    const root = await makeRoot();
    const server = await startServer(configFor(root));
    const url = `http://127.0.0.1:${server.port}`;

    await server.close();
    await server.close();
    running.push(server);

    await expect(fetch(`${url}/health/live`)).rejects.toThrow();
  });

  it("fails without leaking the data directory path", async () => {
    const root = await makeRoot();
    const file = path.join(root, "not-a-directory");
    await writeFile(file, "x");
    const config = configFor(root);
    config.dataDir = file;
    config.workspaceDatabasePath = path.join(file, "workspace.sqlite");
    config.authDatabasePath = path.join(file, "auth.sqlite");
    config.blobRoot = path.join(file, "blobs");

    let error: unknown;

    try {
      await startServer(config);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain(file);
  });
});
