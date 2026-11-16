import { describe, expect, it } from "vitest";

import { DEFAULT_SYNC_POLICY, type SyncPolicy } from "../policy";
import { payloadHash } from "../hash";
import {
  prepareSyncChanges,
  recordPreparedSyncChanges,
  recordSyncChanges,
} from "../recorder";
import type { SyncChange, SyncStore } from "../store";
import type {
  SyncConflictRow,
  SyncDeviceRow,
  SyncEntityType,
  SyncFieldMetaRow,
  SyncMetaRow,
  SyncOutboxRow,
  SyncTombstoneRow,
  WorkspaceSyncStateRow,
} from "../types";

const DAY = 24 * 60 * 60 * 1000;
const NOW = "2026-11-15T10:00:00.000Z";

function outboxPolicy(maxRows = 1000): SyncPolicy {
  return {
    outbox: { ...DEFAULT_SYNC_POLICY.outbox, enabled: true, maxRows },
  };
}

function change(overrides: Partial<SyncChange> = {}): SyncChange {
  return {
    workspaceId: "ws-1",
    entityType: "note",
    entityId: "note-1",
    operation: "create",
    fieldPatches: { title: "Hello" },
    at: NOW,
    contentHash: null,
    ...overrides,
  };
}

class FakeStore implements SyncStore {
  readonly deviceId = "device-1";
  private devices = new Map<string, SyncDeviceRow>();
  private states = new Map<string, WorkspaceSyncStateRow>();
  private entityMeta = new Map<string, SyncMetaRow>();
  private fieldMeta = new Map<string, SyncFieldMetaRow>();
  private outbox = new Map<string, SyncOutboxRow>();
  private tombstones = new Map<string, SyncTombstoneRow>();
  private conflicts = new Map<string, SyncConflictRow>();

  private key(...parts: string[]): string {
    return parts.join("\u0000");
  }

  async getOrCreateDevice(workspaceId: string, at: string): Promise<SyncDeviceRow> {
    const key = this.key(workspaceId, this.deviceId);
    const existing = this.devices.get(key);
    if (existing) return { ...existing };
    const row: SyncDeviceRow = {
      workspaceId,
      deviceId: this.deviceId,
      registeredAt: at,
      lastSeenAt: at,
      lastAckedTombstoneWorkspaceRevision: 0,
      state: "active",
      publicKey: null,
    };
    this.devices.set(key, row);
    return { ...row };
  }

  async getDevice(workspaceId: string, deviceId: string): Promise<SyncDeviceRow | null> {
    return this.devices.get(this.key(workspaceId, deviceId)) ?? null;
  }

  async listDevices(workspaceId: string): Promise<SyncDeviceRow[]> {
    return [...this.devices.values()].filter((row) => row.workspaceId === workspaceId);
  }

  async getWorkspaceState(
    workspaceId: string,
    deviceId: string
  ): Promise<WorkspaceSyncStateRow | null> {
    return this.states.get(this.key(workspaceId, deviceId)) ?? null;
  }

  async getOrCreateWorkspaceState(
    workspaceId: string,
    deviceId: string,
    at: string
  ): Promise<WorkspaceSyncStateRow> {
    const key = this.key(workspaceId, deviceId);
    const existing = this.states.get(key);
    if (existing) return { ...existing };
    const row: WorkspaceSyncStateRow = {
      workspaceId,
      deviceId,
      remoteWorkspaceId: null,
      lastServerCursor: null,
      lastLocalWorkspaceRevision: 0,
      lastLocalSequence: 0,
      tombstoneFloor: 0,
      lastFullResyncAt: at,
    };
    this.states.set(key, row);
    return { ...row };
  }

  async putWorkspaceState(row: WorkspaceSyncStateRow): Promise<void> {
    this.states.set(this.key(row.workspaceId, row.deviceId), { ...row });
  }

  async hasRemoteTarget(workspaceId: string): Promise<boolean> {
    return [...this.states.values()].some(
      (row) => row.workspaceId === workspaceId && row.remoteWorkspaceId !== null
    );
  }

  async getEntityMeta(
    workspaceId: string,
    entityType: SyncEntityType,
    entityId: string
  ): Promise<SyncMetaRow | null> {
    return this.entityMeta.get(this.key(workspaceId, entityType, entityId)) ?? null;
  }

  async listEntityMeta(workspaceId: string): Promise<SyncMetaRow[]> {
    return [...this.entityMeta.values()].filter((row) => row.workspaceId === workspaceId);
  }

  async putEntityMeta(row: SyncMetaRow): Promise<void> {
    this.entityMeta.set(this.key(row.workspaceId, row.entityType, row.entityId), {
      ...row,
    });
  }

  async getFieldMeta(
    workspaceId: string,
    entityType: SyncEntityType,
    entityId: string,
    fieldPath: string
  ): Promise<SyncFieldMetaRow | null> {
    return (
      this.fieldMeta.get(this.key(workspaceId, entityType, entityId, fieldPath)) ?? null
    );
  }

  async listFieldMeta(workspaceId: string): Promise<SyncFieldMetaRow[]> {
    return [...this.fieldMeta.values()].filter((row) => row.workspaceId === workspaceId);
  }

  async putFieldMeta(row: SyncFieldMetaRow): Promise<void> {
    this.fieldMeta.set(
      this.key(row.workspaceId, row.entityType, row.entityId, row.fieldPath),
      { ...row }
    );
  }

  async appendOutbox(row: SyncOutboxRow): Promise<void> {
    if (this.outbox.has(row.opId)) {
      throw new Error("duplicate outbox op");
    }
    this.outbox.set(row.opId, {
      ...row,
      fieldPatches: { ...row.fieldPatches },
    });
    const key = this.key(row.workspaceId, row.deviceId);
    const state = this.states.get(key);
    if (state !== undefined) {
      this.states.set(key, {
        ...state,
        lastLocalSequence: Math.max(state.lastLocalSequence, row.localSequence),
      });
    }
  }

  async listOutbox(workspaceId: string): Promise<SyncOutboxRow[]> {
    return [...this.outbox.values()].filter((row) => row.workspaceId === workspaceId);
  }

  async nextLocalSequence(workspaceId: string, deviceId: string): Promise<number> {
    return (this.states.get(this.key(workspaceId, deviceId))?.lastLocalSequence ?? 0) + 1;
  }

  async deleteOutbox(opId: string): Promise<void> {
    this.outbox.delete(opId);
  }

  async getTombstone(
    workspaceId: string,
    entityType: SyncEntityType,
    entityId: string
  ): Promise<SyncTombstoneRow | null> {
    return this.tombstones.get(this.key(workspaceId, entityType, entityId)) ?? null;
  }

  async listTombstones(workspaceId: string): Promise<SyncTombstoneRow[]> {
    return [...this.tombstones.values()].filter((row) => row.workspaceId === workspaceId);
  }

  async putTombstone(row: SyncTombstoneRow): Promise<void> {
    this.tombstones.set(this.key(row.workspaceId, row.entityType, row.entityId), {
      ...row,
    });
  }

  async listConflicts(
    workspaceId: string,
    state?: "open" | "resolved"
  ): Promise<SyncConflictRow[]> {
    return [...this.conflicts.values()].filter(
      (row) =>
        row.workspaceId === workspaceId && (state === undefined || row.state === state)
    );
  }

  async putConflict(row: SyncConflictRow): Promise<void> {
    this.conflicts.set(row.conflictId, { ...row });
  }

  async resolveConflict(
    conflictId: string,
    input: {
      resolution: "local" | "remote" | "merged" | "copy";
      resolvedAt: string;
      resolvedByDeviceId: string;
    }
  ): Promise<SyncConflictRow> {
    const row = this.conflicts.get(conflictId);
    if (!row) throw new Error("conflict not found");
    const resolved: SyncConflictRow = {
      ...row,
      state: "resolved",
      resolution: input.resolution,
      resolvedAt: input.resolvedAt,
      resolvedByDeviceId: input.resolvedByDeviceId,
    };
    this.conflicts.set(conflictId, resolved);
    return resolved;
  }

  async clearWorkspace(workspaceId: string): Promise<void> {
    for (const [key, row] of this.entityMeta) {
      if (row.workspaceId === workspaceId) this.entityMeta.delete(key);
    }
    for (const [key, row] of this.fieldMeta) {
      if (row.workspaceId === workspaceId) this.fieldMeta.delete(key);
    }
    for (const [key, row] of this.outbox) {
      if (row.workspaceId === workspaceId) this.outbox.delete(key);
    }
    for (const [key, row] of this.tombstones) {
      if (row.workspaceId === workspaceId) this.tombstones.delete(key);
    }
    for (const [key, row] of this.conflicts) {
      if (row.workspaceId === workspaceId) this.conflicts.delete(key);
    }
  }
}

describe("sync recorder", () => {
  it("bumps entity and workspace revisions once per batch", async () => {
    const store = new FakeStore();
    const result = await recordSyncChanges(store, {
      changes: [change({ entityId: "note-1" }), change({ entityId: "note-2" })],
    });

    expect(result.workspaceRevision).toBe(1);
    expect(await store.getEntityMeta("ws-1", "note", "note-1")).toMatchObject({
      entityRevision: 1,
      workspaceRevision: 1,
    });
    expect(await store.getEntityMeta("ws-1", "note", "note-2")).toMatchObject({
      entityRevision: 1,
      workspaceRevision: 1,
    });
    expect(await store.getWorkspaceState("ws-1", "device-1")).toMatchObject({
      lastLocalWorkspaceRevision: 1,
    });
  });

  it("updates only changed field metadata on update", async () => {
    const store = new FakeStore();
    await recordSyncChanges(store, {
      changes: [change({ fieldPatches: { title: "Hello", content: "Body" } })],
    });
    await recordSyncChanges(store, {
      changes: [change({ operation: "update", fieldPatches: { title: "Changed" } })],
    });

    expect(await store.getFieldMeta("ws-1", "note", "note-1", "title")).toMatchObject({
      fieldRevision: 2,
      workspaceRevision: 2,
    });
    expect(await store.getFieldMeta("ws-1", "note", "note-1", "content")).toMatchObject({
      fieldRevision: 1,
      workspaceRevision: 1,
    });
  });

  it("writes a tombstone and deletedAt on delete", async () => {
    const store = new FakeStore();
    await recordSyncChanges(store, { changes: [change()] });
    const result = await recordSyncChanges(store, {
      changes: [change({ operation: "delete", fieldPatches: {} })],
    });

    expect(result.workspaceRevision).toBe(2);
    expect(await store.getTombstone("ws-1", "note", "note-1")).toMatchObject({
      state: "active",
      tombstoneWorkspaceRevision: 2,
      deletedByDeviceId: "device-1",
    });
    expect(await store.getEntityMeta("ws-1", "note", "note-1")).toMatchObject({
      deletedAt: NOW,
      entityRevision: 2,
    });
    expect(await store.getFieldMeta("ws-1", "note", "note-1", "title")).toMatchObject({
      deletedAt: NOW,
    });
  });

  it("writes no outbox rows when disabled", async () => {
    const store = new FakeStore();
    await recordSyncChanges(store, { changes: [change()] });
    expect(await store.listOutbox("ws-1")).toEqual([]);
  });

  it("writes an immutable hashed outbox row when enabled", async () => {
    const store = new FakeStore();
    const policy = outboxPolicy();
    const [prepared] = await prepareSyncChanges({
      changes: [change({ opId: "op-1" })],
      policy,
    });
    expect(prepared?.payloadHash).toMatch(/^[0-9a-f]{64}$/);

    await recordPreparedSyncChanges(store, {
      changes: [
        {
          ...prepared!,
          opId: "op-1",
          payloadHash: prepared!.payloadHash,
        },
      ],
      policy,
    });
    const [row] = await store.listOutbox("ws-1");
    expect(row).toMatchObject({
      opId: "op-1",
      state: "pending",
      attempts: 0,
      ackedAt: null,
      payloadHash: prepared!.payloadHash,
    });

    const [again] = await prepareSyncChanges({
      changes: [change({ opId: "op-1" })],
      policy,
    });
    expect(again?.payloadHash).toBe(prepared?.payloadHash);
  });

  it("canonicalizes relation arrays before hashing", async () => {
    const policy = outboxPolicy();
    const [left] = await prepareSyncChanges({
      changes: [
        change({
          opId: "op-relations",
          entityType: "tag",
          fieldPatches: { tagIds: ["b", "a"] },
        }),
      ],
      policy,
    });
    const [right] = await prepareSyncChanges({
      changes: [
        change({
          opId: "op-relations",
          entityType: "tag",
          fieldPatches: { tagIds: ["a", "b"] },
        }),
      ],
      policy,
    });

    expect(left?.fieldPatches.tagIds).toEqual(["a", "b"]);
    expect(right?.fieldPatches.tagIds).toEqual(["a", "b"]);
    expect(left?.payloadHash).toBe(right?.payloadHash);
  });

  it("does not reuse a localSequence after the outbox row is deleted", async () => {
    const store = new FakeStore();
    const policy = outboxPolicy();
    await recordSyncChanges(store, {
      changes: [change({ entityId: "note-a" })],
      policy,
    });
    const [first] = await store.listOutbox("ws-1");
    expect(first).toMatchObject({ localSequence: 1 });
    expect(await store.getWorkspaceState("ws-1", "device-1")).toMatchObject({
      lastLocalSequence: 1,
    });

    await store.deleteOutbox(first!.opId);
    expect(await store.nextLocalSequence("ws-1", "device-1")).toBe(2);

    await recordSyncChanges(store, {
      changes: [change({ entityId: "note-b" })],
      policy,
    });
    expect(await store.listOutbox("ws-1")).toMatchObject([
      { entityId: "note-b", localSequence: 2 },
    ]);
  });

  it("scopes localSequence per workspace and device", async () => {
    const store = new FakeStore();
    const policy = outboxPolicy();
    await recordSyncChanges(store, {
      changes: [change({ entityId: "note-a" })],
      policy,
    });
    await recordSyncChanges(store, {
      changes: [change({ entityId: "note-b" })],
      policy,
    });
    await recordSyncChanges(store, {
      changes: [change({ workspaceId: "ws-2", entityId: "note-c" })],
      policy,
    });

    const workspaceOne = (await store.listOutbox("ws-1")).map((row) => row.localSequence);
    const workspaceTwo = (await store.listOutbox("ws-2")).map((row) => row.localSequence);
    expect(workspaceOne).toEqual([1, 2]);
    expect(workspaceTwo).toEqual([1]);
  });

  it("rejects a batch spanning workspaces", async () => {
    const store = new FakeStore();
    await expect(
      recordSyncChanges(store, {
        changes: [change({ entityId: "note-a" }), change({ workspaceId: "ws-2" })],
      })
    ).rejects.toMatchObject({ code: "invalid_sync_state" });
  });

  it("rejects a batch at the outbox cap", async () => {
    const store = new FakeStore();
    await expect(
      recordSyncChanges(store, {
        changes: [change({ entityId: "note-a" }), change({ entityId: "note-b" })],
        policy: outboxPolicy(1),
      })
    ).rejects.toMatchObject({ code: "outbox_full" });
  });

  it("rejects a write to a tombstoned entity id", async () => {
    const store = new FakeStore();
    await recordSyncChanges(store, { changes: [change()] });
    await recordSyncChanges(store, {
      changes: [change({ operation: "delete", fieldPatches: {} })],
    });

    await expect(
      recordSyncChanges(store, {
        changes: [change({ operation: "update", fieldPatches: { title: "No" } })],
      })
    ).rejects.toMatchObject({ code: "tombstoned_entity" });
  });

  it("reuses a provided workspace revision across batches", async () => {
    const store = new FakeStore();
    const first = await recordSyncChanges(store, {
      changes: [change({ entityId: "note-a" })],
      workspaceRevision: 1,
    });
    const second = await recordSyncChanges(store, {
      changes: [change({ entityId: "note-b" })],
      workspaceRevision: 1,
    });

    expect(first.workspaceRevision).toBe(1);
    expect(second.workspaceRevision).toBe(1);
    expect(await store.getWorkspaceState("ws-1", "device-1")).toMatchObject({
      lastLocalWorkspaceRevision: 1,
    });
    expect(await store.getEntityMeta("ws-1", "note", "note-b")).toMatchObject({
      workspaceRevision: 1,
    });
  });

  it("prunes acknowledged outbox rows older than the retention window", async () => {
    const store = new FakeStore();
    const policy = outboxPolicy();
    await store.getOrCreateDevice("ws-1", NOW);
    await store.getOrCreateWorkspaceState("ws-1", "device-1", NOW);

    const old = new Date(Date.now() - 31 * DAY).toISOString();
    await store.appendOutbox({
      opId: "op-old",
      workspaceId: "ws-1",
      entityType: "note",
      entityId: "old",
      operation: "create",
      baseEntityRevision: 0,
      baseWorkspaceRevision: 0,
      fieldPatches: {},
      payloadHash: "a".repeat(64),
      createdAt: old,
      deviceId: "device-1",
      localSequence: 1,
      attempts: 1,
      state: "acked",
      ackedAt: old,
    });
    await store.appendOutbox({
      opId: "op-pending",
      workspaceId: "ws-1",
      entityType: "note",
      entityId: "pending",
      operation: "create",
      baseEntityRevision: 0,
      baseWorkspaceRevision: 0,
      fieldPatches: {},
      payloadHash: "b".repeat(64),
      createdAt: old,
      deviceId: "device-1",
      localSequence: 2,
      attempts: 0,
      state: "pending",
      ackedAt: null,
    });

    await recordSyncChanges(store, {
      changes: [change({ entityId: "note-new" })],
      policy,
    });

    const ids = (await store.listOutbox("ws-1")).map((row) => row.opId);
    expect(ids).not.toContain("op-old");
    expect(ids).toContain("op-pending");
  });
});

describe("payload hashing", () => {
  it("is deterministic regardless of object key order", async () => {
    const left = await payloadHash({
      opId: "op-1",
      workspaceId: "ws-1",
      entityType: "note",
      entityId: "note-1",
      operation: "create",
      fieldPatches: { title: "Hello", content: "Body" },
    });
    const right = await payloadHash({
      opId: "op-1",
      workspaceId: "ws-1",
      entityType: "note",
      entityId: "note-1",
      operation: "create",
      fieldPatches: { content: "Body", title: "Hello" },
    });

    expect(left).toBe(right);
    expect(left).toMatch(/^[0-9a-f]{64}$/);
  });
});
