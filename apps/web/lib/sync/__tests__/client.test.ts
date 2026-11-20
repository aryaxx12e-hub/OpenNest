import { randomUUID } from "node:crypto";

import { createMemorySyncStore, seedDevice, type SyncOutboxRow } from "@opennest/sync";
import {
  SYNC_PROTOCOL_VERSION,
  type AppliedOperation,
  type PullResponse,
  type PushResponse,
  type SyncConflict,
} from "@opennest/sync-protocol";
import type { IsoDate } from "@opennest/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createSyncClient, type SyncClient } from "../client";
import { SyncRequestError, type SyncRequest } from "../request";

const NOW = "2026-11-19T12:00:00.000Z" as IsoDate;
const WORKSPACE_ID = randomUUID();
const DEVICE_ID = randomUUID();

const clients: SyncClient[] = [];

function outboxRow(overrides: Partial<SyncOutboxRow> = {}): SyncOutboxRow {
  return {
    opId: randomUUID(),
    workspaceId: WORKSPACE_ID,
    entityType: "note",
    entityId: randomUUID(),
    operation: "update",
    baseEntityRevision: 1,
    baseWorkspaceRevision: 0,
    fieldPatches: { title: "Queued" },
    payloadHash: "a".repeat(64),
    createdAt: NOW,
    deviceId: DEVICE_ID,
    localSequence: 1,
    attempts: 0,
    state: "pending",
    ackedAt: null,
    ...overrides,
  };
}

function pushResponse(
  appliedOpIds: readonly string[],
  conflicts: readonly SyncConflict[] = []
): PushResponse {
  return {
    protocolVersion: SYNC_PROTOCOL_VERSION,
    workspaceId: WORKSPACE_ID as PushResponse["workspaceId"],
    applied: appliedOpIds.map((opId, index) => ({
      opId: opId as PushResponse["applied"][number]["opId"],
      canonicalRevision: index + 1,
      entityRevision: 2,
      fieldRevisions: { title: 2 },
      replayed: false,
      appliedAt: NOW as PushResponse["applied"][number]["appliedAt"],
    })),
    conflicts: [...conflicts],
    rejected: [],
  };
}

function emptyPull(): PullResponse {
  return {
    protocolVersion: SYNC_PROTOCOL_VERSION,
    workspaceId: WORKSPACE_ID as PullResponse["workspaceId"],
    operations: [],
    nextCursor: null,
  };
}

function successRequest(applied: readonly string[] = []): {
  request: SyncRequest;
  push: ReturnType<typeof vi.fn>;
} {
  const push = vi.fn(async () => pushResponse(applied));

  return {
    request: { push, pull: vi.fn(async () => emptyPull()) },
    push,
  };
}

function makeClient(
  request: SyncRequest,
  overrides: Partial<Parameters<typeof createSyncClient>[0]> = {}
): SyncClient {
  const client = createSyncClient({
    workspaceId: WORKSPACE_ID,
    store: createMemorySyncStore(),
    request,
    isOnline: () => true,
    now: () => new Date(NOW),
    subscribeToConnection: () => () => undefined,
    scheduleRetry: () => () => undefined,
    ...overrides,
  });

  clients.push(client);
  return client;
}

afterEach(() => {
  for (const client of clients.splice(0)) {
    client.stop();
  }
});

describe("sync client", () => {
  it("keeps queued writes offline and sends them when the connection returns", async () => {
    let online = false;
    const store = createMemorySyncStore();
    const row = outboxRow();
    const { request, push } = successRequest([row.opId]);

    await store.appendOutbox(row);

    const client = makeClient(request, {
      store,
      isOnline: () => online,
    });

    client.start();
    expect(client.getSnapshot().status).toBe("offline");
    expect(push).not.toHaveBeenCalled();
    expect(await store.listOutbox(WORKSPACE_ID)).toHaveLength(1);

    online = true;
    await client.syncNow();

    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0]?.[0]).toMatchObject({
      workspaceId: WORKSPACE_ID,
      operations: [expect.objectContaining({ opId: row.opId })],
    });
    expect(await store.listOutbox(WORKSPACE_ID)).toHaveLength(0);
    expect(client.getSnapshot()).toMatchObject({
      status: "online",
      pendingCount: 0,
      lastError: null,
    });
  });

  it("retries retryable failures with bounded backoff", async () => {
    const { request, push } = successRequest();
    const store = createMemorySyncStore();
    const row = outboxRow();
    const scheduleRetry = vi.fn(() => () => undefined);

    await store.appendOutbox(row);
    push.mockRejectedValueOnce(new SyncRequestError(503, "unavailable", true));

    const client = makeClient(request, {
      store,
      scheduleRetry,
      backoff: { baseMs: 1000, maxMs: 30_000, jitterRatio: 0, random: () => 0.5 },
    });
    const result = await client.syncNow();

    expect(result).toMatchObject({ status: "error", retryable: true });
    expect(client.getSnapshot().status).toBe("connecting");
    expect(scheduleRetry).toHaveBeenCalledWith(expect.any(Function), 1000);
    expect(await store.listOutbox(WORKSPACE_ID)).toHaveLength(1);

    push.mockResolvedValueOnce(pushResponse([row.opId]));
    await client.syncNow();

    expect(await store.listOutbox(WORKSPACE_ID)).toHaveLength(0);
    expect(client.getSnapshot().status).toBe("online");
  });

  it("stops retrying after a terminal client error", async () => {
    const { request, push } = successRequest();
    const store = createMemorySyncStore();
    const scheduleRetry = vi.fn(() => () => undefined);

    await store.appendOutbox(outboxRow());
    push.mockRejectedValueOnce(new SyncRequestError(403, "forbidden", false));

    const client = makeClient(request, { store, scheduleRetry });
    const result = await client.syncNow();

    expect(result).toMatchObject({ status: "error", retryable: false });
    expect(client.getSnapshot()).toMatchObject({
      status: "error",
      lastError: "forbidden",
    });
    expect(scheduleRetry).not.toHaveBeenCalled();
    expect(await store.listOutbox(WORKSPACE_ID)).toHaveLength(1);
  });

  it("never starts the engine in local-only mode", async () => {
    const { request, push } = successRequest();
    const client = makeClient(request, { enabled: false });

    client.start();

    expect(client.getSnapshot().status).toBe("disabled");
    await expect(client.syncNow()).resolves.toEqual({ status: "disabled" });
    expect(push).not.toHaveBeenCalled();
  });

  it("stores conflicts and removes acknowledged outbox rows", async () => {
    const store = createMemorySyncStore();
    const row = outboxRow();
    const conflict: SyncConflict = {
      conflictId: randomUUID(),
      entityType: "note",
      entityId: randomUUID(),
      fieldPath: "title",
      localOpId: randomUUID(),
      remoteOpId: row.opId,
      localFieldRevision: 2,
      remoteFieldRevision: 3,
      localValue: "Mine",
      remoteValue: "Theirs",
      localDeviceId: DEVICE_ID,
      remoteDeviceId: randomUUID(),
      createdAt: NOW,
    };
    const push = vi.fn(async () => pushResponse([row.opId], [conflict]));
    const request: SyncRequest = { push, pull: vi.fn(async () => emptyPull()) };

    await store.appendOutbox(row);

    const client = makeClient(request, { store });
    await client.syncNow();

    expect(await store.listConflicts(WORKSPACE_ID, "open")).toEqual([
      expect.objectContaining({
        conflictId: conflict.conflictId,
        localValue: "Mine",
        remoteValue: "Theirs",
        state: "open",
        resolution: null,
      }),
    ]);
    expect(await store.listOutbox(WORKSPACE_ID)).toHaveLength(0);
  });

  it("applies remote pages and saves the cursor after the page succeeds", async () => {
    const store = createMemorySyncStore();
    await seedDevice(store, WORKSPACE_ID, DEVICE_ID, NOW);
    const pull = vi
      .fn<SyncRequest["pull"]>()
      .mockResolvedValueOnce({
        ...emptyPull(),
        operations: [remoteOperation()],
        nextCursor: "next" as PullResponse["nextCursor"],
      })
      .mockRejectedValueOnce(new SyncRequestError(503, "unavailable", true));
    const request: SyncRequest = {
      push: vi.fn(async () => pushResponse([])),
      pull,
    };
    const received: AppliedOperation[] = [];
    const client = makeClient(request, {
      store,
      onRemoteOperations: async (operations) => {
        received.push(...operations);
      },
    });

    await client.syncNow();

    expect(received).toHaveLength(1);
    const state = await store.getWorkspaceState(WORKSPACE_ID, DEVICE_ID);
    expect(state?.lastServerCursor).toBe("next");
  });
});

function remoteOperation(): AppliedOperation {
  return {
    opId: randomUUID(),
    entityType: "note",
    entityId: randomUUID(),
    operation: "update",
    baseEntityRevision: 1,
    baseWorkspaceRevision: 0,
    fieldPatches: { title: "Remote" },
    payloadHash: "b".repeat(64),
    deviceId: randomUUID(),
    localSequence: 2,
    createdAt: NOW,
    canonicalRevision: 1,
  };
}
