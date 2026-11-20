// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { IsoDate } from "@opennest/core";
import { createSqliteStorage } from "@opennest/storage-sqlite";
import { WebSocket } from "ws";
import { afterEach, describe, expect, it } from "vitest";

import { openAuthDatabase } from "../../auth/auth-db";
import { bootstrapOwner } from "../../auth/membership";
import { startServer, type RunningServer, type ServerConfig } from "../../index";

const NOW = "2026-11-19T12:00:00.000Z" as IsoDate;
const PASSWORD = "correct horse battery staple";
const roots: string[] = [];
const running: RunningServer[] = [];

function cookieHeader(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((line) => line.split(";")[0] ?? "")
    .join("; ");
}

async function startFixture(): Promise<{
  running: RunningServer;
  config: ServerConfig;
  noteId: string;
  cookie: string;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "opennest-collaboration-server-"));
  roots.push(root);
  const config: ServerConfig = {
    dataDir: root,
    host: "127.0.0.1",
    port: 0,
    publicUrl: "http://127.0.0.1:0",
    workspaceDatabasePath: path.join(root, "workspace.sqlite"),
    authDatabasePath: path.join(root, "auth.sqlite"),
    blobRoot: path.join(root, "blobs"),
    mcpEnabled: false,
  };

  const workspace = createSqliteStorage({
    databaseFile: config.workspaceDatabasePath,
    blobRoot: config.blobRoot,
  });
  await workspace.init();
  const shared = await workspace.workspaces.ensureWorkspace({ at: NOW });
  const note = await workspace.notes.create({
    workspaceId: shared.id,
    folderId: null,
    title: "Live note",
    content: "Hello",
    at: NOW,
  });
  await workspace.close();

  const auth = openAuthDatabase({ databaseFile: config.authDatabasePath });
  await bootstrapOwner(
    auth,
    { email: "owner@example.com", password: PASSWORD },
    new Date(NOW)
  );
  auth.close();

  const started = await startServer(config);
  running.push(started);

  const login = await fetch(
    `${started.url.replace(":0", `:${started.port}`)}/auth/login`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "owner@example.com", password: PASSWORD }),
    }
  );

  expect(login.status).toBe(200);

  return {
    running: started,
    config,
    noteId: note.id,
    cookie: cookieHeader(login),
  };
}

afterEach(async () => {
  await Promise.all(running.splice(0).map((server) => server.close()));
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("collaboration server", () => {
  it("rejects an unauthenticated WebSocket handshake", async () => {
    const { running, config, noteId } = await startFixture();
    const url = `ws://127.0.0.1:${running.port}/api/collaboration?noteId=${noteId}`;

    const status = await new Promise<number>((resolve, reject) => {
      const socket = new WebSocket(url, { origin: config.publicUrl });

      socket.once("unexpected-response", (_request, response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
        socket.terminate();
      });
      socket.once("error", reject);
    });

    expect(status).toBe(401);
  });

  it("joins an authenticated editor and sends the note state", async () => {
    const { running, config, noteId, cookie } = await startFixture();
    const url = `ws://127.0.0.1:${running.port}/api/collaboration?noteId=${noteId}`;

    const messages = await new Promise<Array<Uint8Array | string>>((resolve, reject) => {
      const socket = new WebSocket(url, {
        origin: config.publicUrl,
        headers: { cookie },
      });
      const received: Array<Uint8Array | string> = [];

      socket.on("message", (data, isBinary) => {
        received.push(isBinary ? new Uint8Array(data as Buffer) : data.toString());

        if (
          received.some(
            (message) => typeof message === "string" && message.includes('"type":"ready"')
          )
        ) {
          socket.close();
          resolve(received);
        }
      });
      socket.once("error", reject);
    });

    expect(messages.some((message) => message instanceof Uint8Array)).toBe(true);
    expect(
      messages.find(
        (message) => typeof message === "string" && message.includes('"type":"ready"')
      )
    ).toContain('"role":"owner"');
  });
});
