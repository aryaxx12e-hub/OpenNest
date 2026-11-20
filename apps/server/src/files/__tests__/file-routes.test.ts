// @vitest-environment node

import { File } from "node:buffer";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import type { IsoDate } from "@opennest/core";
import { createSqliteStorage } from "@opennest/storage-sqlite";
import { afterEach, describe, expect, it } from "vitest";

import type { AuthDatabase } from "../../auth/auth-db";
import { createUser, openAuthDatabase } from "../../auth/auth-db";
import { addMembership, bootstrapOwner } from "../../auth/membership";
import { hashPassword } from "../../auth/password";
import { createRouter } from "../../http/router";
import { registerAuthRoutes } from "../../routes/auth";
import { createFileService, type FileService } from "../file-service";
import { openFileStore, type FileStore } from "../file-store";
import { registerFileRoutes } from "../../routes/files";

const PASSWORD = "correct horse battery staple";
const VIEWER_PASSWORD = "viewer password is long";
const NOW = new Date("2026-11-19T12:00:00.000Z");

interface Session {
  cookie: string;
  csrfToken: string;
}

interface FileRouteServer {
  base: string;
  workspaceId: string;
  service: FileService;
  owner: Session;
  viewer: Session;
}

const roots: string[] = [];
const auths: AuthDatabase[] = [];
const stores: FileStore[] = [];
const servers: Server[] = [];

function cookiePair(line: string): string {
  return line.split(";")[0] ?? "";
}

function cookieHeader(response: Response): string {
  return response.headers.getSetCookie().map(cookiePair).join("; ");
}

async function login(base: string, email: string, password: string): Promise<Session> {
  const response = await fetch(`${base}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = (await response.json()) as { csrfToken: string };

  expect(response.status).toBe(200);

  return { cookie: cookieHeader(response), csrfToken: body.csrfToken };
}

async function startFileServer(): Promise<FileRouteServer> {
  const root = await mkdtemp(path.join(tmpdir(), "opennest-file-routes-"));
  roots.push(root);
  const databaseFile = path.join(root, "workspace.sqlite");
  const blobRoot = path.join(root, "blobs");
  const storage = createSqliteStorage({ databaseFile, blobRoot });

  await storage.init();

  let workspaceId: string;

  try {
    const workspace = await storage.workspaces.create({
      name: "Shared workspace",
      at: NOW.toISOString() as IsoDate,
    });
    workspaceId = workspace.id;
  } finally {
    await storage.close();
  }

  const auth = openAuthDatabase({
    databaseFile: path.join(root, "auth.sqlite"),
  });
  auths.push(auth);
  await bootstrapOwner(auth, { email: "owner@example.com", password: PASSWORD }, NOW);

  const viewerDigest = await hashPassword(VIEWER_PASSWORD);
  const viewer = createUser(auth, {
    email: "viewer@example.com",
    digest: viewerDigest,
    now: NOW,
  });
  addMembership(auth, viewer.id, "viewer", NOW);

  const store = openFileStore({ databaseFile });
  stores.push(store);
  const service = await createFileService({
    store,
    blobRoot,
    now: () => NOW,
  });
  const router = createRouter();

  registerAuthRoutes(router, { auth, now: () => NOW });
  registerFileRoutes(router, { auth, files: service, now: () => NOW });

  const server = createServer((request, response) => {
    void router.handle(request, response);
  });
  servers.push(server);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${address.port}`;

  return {
    base,
    workspaceId,
    service,
    owner: await login(base, "owner@example.com", PASSWORD),
    viewer: await login(base, "viewer@example.com", VIEWER_PASSWORD),
  };
}

function uploadForm(
  name: string,
  mimeType: string,
  data: Uint8Array,
  fields: Record<string, string> = {}
): FormData {
  const form = new FormData();

  form.set("file", new File([data], name, { type: mimeType }), name);

  for (const [key, value] of Object.entries(fields)) {
    form.set(key, value);
  }

  return form;
}

function writeHeaders(session: Session): Record<string, string> {
  return {
    cookie: session.cookie,
    "x-csrf-token": session.csrfToken,
  };
}

async function upload(
  server: FileRouteServer,
  session: Session,
  form: FormData
): Promise<Response> {
  return fetch(`${server.base}/api/files`, {
    method: "POST",
    headers: writeHeaders(session),
    body: form,
  });
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

  for (const store of stores.splice(0)) {
    store.close();
  }

  for (const auth of auths.splice(0)) {
    auth.close();
  }

  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("file routes", () => {
  it("uploads a file and downloads it with safe attachment headers", async () => {
    const server = await startFileServer();
    const content = new TextEncoder().encode("quarterly results");
    const uploaded = await upload(
      server,
      server.owner,
      uploadForm("Quarterly report.txt", "text/plain", content)
    );

    expect(uploaded.status).toBe(201);
    const body = (await uploaded.json()) as {
      file: { id: string; name: string; mimeType: string };
      version: { id: string; versionNumber: number };
      conflict: boolean;
      conflictOf: string | null;
    };

    expect(body.file.name).toBe("Quarterly report.txt");
    expect(body.file.mimeType).toBe("text/plain");
    expect(body.version.versionNumber).toBe(1);
    expect(body.conflict).toBe(false);
    expect(body.conflictOf).toBeNull();

    const downloaded = await fetch(`${server.base}/api/files/${body.file.id}`, {
      headers: { cookie: server.owner.cookie },
    });

    expect(downloaded.status).toBe(200);
    expect(downloaded.headers.get("content-type")).toBe("text/plain");
    expect(downloaded.headers.get("x-content-type-options")).toBe("nosniff");
    expect(downloaded.headers.get("cache-control")).toBe("no-store");
    expect(downloaded.headers.get("content-disposition")).toContain("attachment;");
    expect(downloaded.headers.get("content-disposition")).toContain(
      "filename*=UTF-8''Quarterly%20report.txt"
    );
    expect(new Uint8Array(await downloaded.arrayBuffer())).toEqual(content);
  });

  it("lets a viewer download but not upload", async () => {
    const server = await startFileServer();
    const content = new TextEncoder().encode("shared notes");
    const uploaded = await upload(
      server,
      server.owner,
      uploadForm("shared.txt", "text/plain", content)
    );
    const body = (await uploaded.json()) as { file: { id: string } };

    const downloaded = await fetch(`${server.base}/api/files/${body.file.id}`, {
      headers: { cookie: server.viewer.cookie },
    });
    expect(downloaded.status).toBe(200);

    const rejected = await upload(
      server,
      server.viewer,
      uploadForm("viewer.txt", "text/plain", content)
    );
    expect(rejected.status).toBe(403);
    const error = (await rejected.json()) as { error: { code: string } };
    expect(error.error.code).toBe("forbidden");
  });

  it("rejects path traversal in a file identifier", async () => {
    const server = await startFileServer();
    const response = await fetch(`${server.base}/api/files/..%2F..%2Fetc%2Fpasswd`, {
      headers: { cookie: server.owner.cookie },
    });

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("invalid_file_id");
  });

  it("requires a session before accepting an upload", async () => {
    const server = await startFileServer();
    const response = await fetch(`${server.base}/api/files`, {
      method: "POST",
      body: uploadForm("anonymous.txt", "text/plain", new TextEncoder().encode("no")),
    });

    expect(response.status).toBe(401);
  });

  it("returns the conflict copy when the base version is stale", async () => {
    const server = await startFileServer();
    const first = await upload(
      server,
      server.owner,
      uploadForm("conflict.txt", "text/plain", new TextEncoder().encode("base"))
    );
    const firstBody = (await first.json()) as {
      file: { id: string };
      version: { id: string };
    };

    const updated = await upload(
      server,
      server.owner,
      uploadForm("conflict.txt", "text/plain", new TextEncoder().encode("new"), {
        fileId: firstBody.file.id,
        baseVersionId: firstBody.version.id,
      })
    );
    expect(updated.status).toBe(201);

    const stale = await upload(
      server,
      server.owner,
      uploadForm("conflict.txt", "text/plain", new TextEncoder().encode("stale"), {
        fileId: firstBody.file.id,
        baseVersionId: firstBody.version.id,
      })
    );

    expect(stale.status).toBe(201);
    const staleBody = (await stale.json()) as {
      file: { id: string; name: string };
      conflict: boolean;
      conflictOf: string | null;
    };
    expect(staleBody.conflict).toBe(true);
    expect(staleBody.conflictOf).toBe(firstBody.file.id);
    expect(staleBody.file.id).not.toBe(firstBody.file.id);
    expect(staleBody.file.name).toContain("(conflict copy)");
  });
});
