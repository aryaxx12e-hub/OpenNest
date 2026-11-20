// @vitest-environment node

import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { IsoDate } from "@opennest/core";
import { createSqliteStorage } from "@opennest/storage-sqlite";
import { payloadHash } from "@opennest/sync";
import {
  SYNC_PROTOCOL_VERSION,
  type SyncEntityType,
  type SyncOperation,
  type SyncOperationType,
} from "@opennest/sync-protocol";
import { afterEach, describe, expect, it } from "vitest";

import { createAuditLog } from "../../audit/audit-log";
import { openAuthDatabase, type AuthDatabase } from "../../auth/auth-db";
import { bootstrapOwner } from "../../auth/membership";
import { createRateLimiter } from "../../http/rate-limit";
import { createRouter } from "../../http/router";
import { registerAuthRoutes } from "../../routes/auth";
import { registerBootstrapRoutes } from "../../routes/bootstrap";
import { registerMembershipRoutes } from "../../routes/membership";
import { registerSyncRoutes } from "../../routes/sync";
import { createSyncService } from "../sync-service";
import { openSyncStore, type SyncStore } from "../sync-store";

const PASSWORD = "correct horse battery staple";
const NOW = new Date("2026-11-19T12:00:00.000Z");
const DEVICE_ID = randomUUID();

interface OperationOverrides {
  entityType?: SyncEntityType;
  entityId?: string;
  operation?: SyncOperationType;
  baseEntityRevision?: number;
  fieldPatches?: Record<string, unknown>;
}

interface SyncRouteServer {
  base: string;
  databaseFile: string;
  workspaceId: string;
  theOperation: (overrides?: OperationOverrides) => Promise<SyncOperation>;
}

interface Session {
  cookie: string;
  csrfToken: string;
}

const roots: string[] = [];
const auths: AuthDatabase[] = [];
const stores: SyncStore[] = [];
const servers: Server[] = [];

async function startSyncServer(): Promise<SyncRouteServer> {
  const root = await mkdtemp(path.join(tmpdir(), "opennest-sync-routes-"));
  roots.push(root);
  const databaseFile = path.join(root, "workspace.sqlite");
  const storage = createSqliteStorage({
    databaseFile,
    blobRoot: path.join(root, "blobs"),
  });

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
  const audit = createAuditLog(auth);
  await bootstrapOwner(
    auth,
    { email: "owner@example.com", password: PASSWORD },
    NOW,
    audit
  );
  const store = openSyncStore({ databaseFile });
  stores.push(store);
  const service = createSyncService({ store, now: () => NOW });
  const clock = { now: NOW };
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
  registerMembershipRoutes(router, { auth, audit, now: () => clock.now });
  registerSyncRoutes(router, { auth, sync: service, now: () => clock.now });

  const server = createServer((request, response) => {
    void router.handle(request, response);
  });
  servers.push(server);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address() as AddressInfo;
  let sequence = 0;

  async function theOperation(
    overrides: OperationOverrides = {}
  ): Promise<SyncOperation> {
    sequence += 1;
    const opId = randomUUID();
    const entityType = overrides.entityType ?? "note";
    const entityId = overrides.entityId ?? randomUUID();
    const operationType = overrides.operation ?? "create";
    const fieldPatches = overrides.fieldPatches ?? { title: "Note", content: "" };
    const deviceId = DEVICE_ID;

    return {
      opId,
      entityType,
      entityId,
      operation: operationType,
      baseEntityRevision: overrides.baseEntityRevision ?? 0,
      baseWorkspaceRevision: 0,
      fieldPatches,
      payloadHash: await payloadHash({
        opId,
        workspaceId,
        entityType,
        entityId,
        operation: operationType,
        fieldPatches,
      }),
      deviceId,
      localSequence: sequence,
      createdAt: NOW.toISOString() as IsoDate,
    };
  }

  return {
    base: `http://127.0.0.1:${address.port}`,
    databaseFile,
    workspaceId,
    theOperation,
  };
}

function cookiePair(line: string): string {
  return line.split(";")[0] ?? "";
}

function cookieHeader(response: Response): string {
  return response.headers.getSetCookie().map(cookiePair).join("; ");
}

async function login(
  base: string,
  email = "owner@example.com",
  password = PASSWORD
): Promise<Session> {
  const response = await fetch(`${base}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = (await response.json()) as { csrfToken: string };

  expect(response.status).toBe(200);

  return { cookie: cookieHeader(response), csrfToken: body.csrfToken };
}

function headers(session: Session): Record<string, string> {
  return {
    "content-type": "application/json",
    cookie: session.cookie,
    "x-csrf-token": session.csrfToken,
  };
}

async function loginViewer(base: string, owner: Session): Promise<Session> {
  const inviteResponse = await fetch(`${base}/auth/invites`, {
    method: "POST",
    headers: headers(owner),
    body: JSON.stringify({ email: "viewer@example.com", role: "viewer" }),
  });
  const invite = (await inviteResponse.json()) as { token: string };

  expect(inviteResponse.status).toBe(201);

  const accepted = await fetch(`${base}/auth/invites/accept`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      token: invite.token,
      password: "viewer password is long",
    }),
  });
  const body = (await accepted.json()) as { csrfToken: string };

  expect(accepted.status).toBe(201);

  return { cookie: cookieHeader(accepted), csrfToken: body.csrfToken };
}

function countNotes(databaseFile: string): number {
  const database = new DatabaseSync(databaseFile, { readOnly: true });

  try {
    const row = database.prepare("SELECT COUNT(*) AS count FROM notes").get() as {
      count: number;
    };

    return row.count;
  } finally {
    database.close();
  }
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

describe("sync routes", () => {
  it("pushes and pulls for an authenticated owner", async () => {
    const server = await startSyncServer();
    const owner = await login(server.base);
    const operation = await server.theOperation();

    const pushed = await fetch(`${server.base}/api/sync/push`, {
      method: "POST",
      headers: headers(owner),
      body: JSON.stringify({
        protocolVersion: SYNC_PROTOCOL_VERSION,
        workspaceId: server.workspaceId,
        operations: [operation],
      }),
    });
    const pushBody = (await pushed.json()) as {
      applied: Array<{ opId: string; canonicalRevision: number }>;
    };

    expect(pushed.status).toBe(200);
    expect(pushBody.applied).toEqual([
      expect.objectContaining({
        opId: operation.opId,
        canonicalRevision: 1,
      }),
    ]);

    const pulled = await fetch(`${server.base}/api/sync/pull`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: owner.cookie },
      body: JSON.stringify({
        protocolVersion: SYNC_PROTOCOL_VERSION,
        workspaceId: server.workspaceId,
        cursor: null,
        limit: 10,
      }),
    });
    const pullBody = (await pulled.json()) as {
      operations: Array<{ opId: string }>;
      nextCursor: string | null;
    };

    expect(pulled.status).toBe(200);
    expect(pullBody.operations.map((item) => item.opId)).toEqual([operation.opId]);
    expect(pullBody.nextCursor).toBeNull();
    expect(countNotes(server.databaseFile)).toBe(1);
  });

  it("rejects viewers and missing authentication or CSRF", async () => {
    const server = await startSyncServer();
    const owner = await login(server.base);
    const viewer = await loginViewer(server.base, owner);
    const operation = await server.theOperation();

    const forbidden = await fetch(`${server.base}/api/sync/push`, {
      method: "POST",
      headers: headers(viewer),
      body: JSON.stringify({
        protocolVersion: SYNC_PROTOCOL_VERSION,
        workspaceId: server.workspaceId,
        operations: [operation],
      }),
    });

    expect(forbidden.status).toBe(403);
    await expect(forbidden.json()).resolves.toMatchObject({
      error: { code: "forbidden" },
    });

    const unauthorized = await fetch(`${server.base}/api/sync/push`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        protocolVersion: SYNC_PROTOCOL_VERSION,
        workspaceId: server.workspaceId,
        operations: [operation],
      }),
    });

    expect(unauthorized.status).toBe(401);

    const noCsrf = await fetch(`${server.base}/api/sync/push`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: owner.cookie,
      },
      body: JSON.stringify({
        protocolVersion: SYNC_PROTOCOL_VERSION,
        workspaceId: server.workspaceId,
        operations: [operation],
      }),
    });

    expect(noCsrf.status).toBe(403);
    await expect(noCsrf.json()).resolves.toMatchObject({
      error: { code: "csrf_invalid" },
    });
    expect(countNotes(server.databaseFile)).toBe(0);
  });

  it("rejects another workspace, an invalid body, and an invalid cursor", async () => {
    const server = await startSyncServer();
    const owner = await login(server.base);
    const operation = await server.theOperation();

    const otherWorkspace = await fetch(`${server.base}/api/sync/push`, {
      method: "POST",
      headers: headers(owner),
      body: JSON.stringify({
        protocolVersion: SYNC_PROTOCOL_VERSION,
        workspaceId: randomUUID(),
        operations: [operation],
      }),
    });

    expect(otherWorkspace.status).toBe(404);

    const invalidBody = await fetch(`${server.base}/api/sync/push`, {
      method: "POST",
      headers: headers(owner),
      body: JSON.stringify({
        protocolVersion: SYNC_PROTOCOL_VERSION,
        workspaceId: server.workspaceId,
        operations: [],
      }),
    });

    expect(invalidBody.status).toBe(400);
    await expect(invalidBody.json()).resolves.toMatchObject({
      error: { code: "invalid_operation" },
    });

    const invalidCursor = await fetch(`${server.base}/api/sync/pull`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: owner.cookie },
      body: JSON.stringify({
        protocolVersion: SYNC_PROTOCOL_VERSION,
        workspaceId: server.workspaceId,
        cursor: "not-a-cursor",
        limit: 10,
      }),
    });

    expect(invalidCursor.status).toBe(400);
    await expect(invalidCursor.json()).resolves.toMatchObject({
      error: { code: "invalid_cursor" },
    });
    expect(countNotes(server.databaseFile)).toBe(0);
  });
});
