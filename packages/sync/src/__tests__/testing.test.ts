import { describe, expect, it } from "vitest";

import type { FieldCandidate } from "../merge";
import { DEFAULT_SYNC_POLICY, type SyncPolicy } from "../policy";
import { recordSyncChanges } from "../recorder";
import type { SyncChange } from "../store";
import type { SyncConflictRow } from "../types";
import { createMemorySyncStore, seedDevice, simulateTwoDeviceMerge } from "../testing";

const NOW = "2026-11-15T10:00:00.000Z";

function outboxPolicy(): SyncPolicy {
  return {
    outbox: { ...DEFAULT_SYNC_POLICY.outbox, enabled: true },
  };
}

function candidate(overrides: Partial<FieldCandidate> = {}): FieldCandidate {
  return {
    workspaceId: "ws-1",
    entityType: "note",
    entityId: "note-1",
    fieldPath: "content",
    value: "local",
    fieldRevision: 1,
    originDeviceId: "device-a",
    opId: "op-a",
    updatedAt: NOW,
    ...overrides,
  };
}

function change(overrides: Partial<SyncChange> = {}): SyncChange {
  return {
    workspaceId: "ws-1",
    entityType: "note",
    entityId: "note-1",
    operation: "update",
    fieldPatches: {},
    at: NOW,
    contentHash: null,
    ...overrides,
  };
}

describe("memory sync harness", () => {
  it("merges independent fields from two devices", async () => {
    const result = await simulateTwoDeviceMerge({
      workspaceId: "ws-1",
      deviceA: "device-a",
      deviceB: "device-b",
      local: [
        candidate({
          fieldPath: "title",
          value: "Local title",
        }),
      ],
      remote: [
        candidate({
          fieldPath: "pinned",
          value: true,
          originDeviceId: "device-b",
          opId: "op-b",
          updatedAt: "2026-11-15T10:01:00.000Z",
        }),
      ],
    });

    expect(result.conflicts).toEqual([]);
  });

  it("deduplicates an outbox replay by opId", async () => {
    const store = createMemorySyncStore();
    await seedDevice(store, "ws-1", "device-a", NOW);
    const input = {
      changes: [
        {
          workspaceId: "ws-1",
          entityType: "note" as const,
          entityId: "note-1",
          operation: "create" as const,
          fieldPatches: { title: "Hello" },
          at: NOW,
          contentHash: null,
          opId: "op-replay",
        },
      ],
      policy: outboxPolicy(),
    };

    await recordSyncChanges(store, input);
    await recordSyncChanges(store, input);

    expect(await store.listOutbox("ws-1")).toHaveLength(1);
    expect(await store.getEntityMeta("ws-1", "note", "note-1")).toMatchObject({
      entityRevision: 1,
    });
  });

  it("preserves a same-field content conflict", async () => {
    const result = await simulateTwoDeviceMerge({
      workspaceId: "ws-1",
      deviceA: "device-a",
      deviceB: "device-b",
      local: [candidate({ value: "local body" })],
      remote: [
        candidate({
          value: "remote body",
          originDeviceId: "device-b",
          opId: "op-b",
          updatedAt: "2026-11-15T10:01:00.000Z",
        }),
      ],
    });

    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toMatchObject({
      workspaceId: "ws-1",
      entityId: "note-1",
      fieldPath: "content",
      localValue: "local body",
      remoteValue: "remote body",
      localDeviceId: "device-a",
      remoteDeviceId: "device-b",
      state: "open",
      resolution: "remote",
    });
  });

  it("lists and resolves a conflict", async () => {
    const store = createMemorySyncStore();
    await seedDevice(store, "ws-1", "device-a", NOW);
    const conflict: SyncConflictRow = {
      conflictId: "conflict-1",
      workspaceId: "ws-1",
      entityType: "note",
      entityId: "note-1",
      fieldPath: "content",
      localFieldRevision: 1,
      remoteFieldRevision: 1,
      localOpId: "op-a",
      remoteOpId: "op-b",
      localValue: "local",
      remoteValue: "remote",
      localDeviceId: "device-a",
      remoteDeviceId: "device-b",
      createdAt: NOW,
      state: "open",
      resolution: "local",
      resolvedAt: null,
      resolvedByDeviceId: null,
    };
    await store.putConflict(conflict);

    expect(await store.listConflicts("ws-1", "open")).toHaveLength(1);
    const resolved = await store.resolveConflict("conflict-1", {
      resolution: "remote",
      resolvedAt: NOW,
      resolvedByDeviceId: "device-a",
    });
    expect(resolved).toMatchObject({
      state: "resolved",
      resolution: "remote",
      resolvedAt: NOW,
      resolvedByDeviceId: "device-a",
    });
    expect(await store.listConflicts("ws-1", "open")).toHaveLength(0);

    await expect(
      store.resolveConflict("conflict-1", {
        resolution: "merged",
        resolvedAt: NOW,
        resolvedByDeviceId: "device-a",
      })
    ).rejects.toMatchObject({ code: "unsupported_resolution" });
  });

  it("rejects a stale device below the tombstone floor", async () => {
    const store = createMemorySyncStore();
    await seedDevice(store, "ws-1", "device-a", NOW);
    await store.putWorkspaceState({
      workspaceId: "ws-1",
      deviceId: "device-a",
      remoteWorkspaceId: null,
      lastServerCursor: null,
      lastLocalWorkspaceRevision: 5,
      lastLocalSequence: 0,
      tombstoneFloor: 5,
      lastFullResyncAt: null,
    });

    await expect(
      recordSyncChanges(store, {
        changes: [
          change({
            fieldPatches: { title: "Hello" },
            opId: "op-a",
            at: NOW,
          }),
        ],
      })
    ).rejects.toMatchObject({ code: "invalid_sync_state" });
  });

  it("rejects a revoked device", async () => {
    const store = createMemorySyncStore();
    await seedDevice(store, "ws-1", "device-a", NOW, { state: "revoked" });

    await expect(
      recordSyncChanges(store, {
        changes: [
          change({
            fieldPatches: { title: "Revoked" },
            opId: "op-revoked",
            at: NOW,
          }),
        ],
      })
    ).rejects.toMatchObject({ code: "invalid_sync_state" });
  });

  it("allows an up-to-date device at or above the tombstone floor", async () => {
    const store = createMemorySyncStore();
    await seedDevice(store, "ws-1", "device-a", NOW, {
      lastAckedTombstoneWorkspaceRevision: 5,
    });
    await store.putWorkspaceState({
      workspaceId: "ws-1",
      deviceId: "device-a",
      remoteWorkspaceId: null,
      lastServerCursor: null,
      lastLocalWorkspaceRevision: 5,
      lastLocalSequence: 0,
      tombstoneFloor: 5,
      lastFullResyncAt: null,
    });

    const result = await recordSyncChanges(store, {
      changes: [
        change({
          fieldPatches: { title: "Current" },
          opId: "op-current",
          at: NOW,
        }),
      ],
    });

    expect(result.workspaceRevision).toBe(6);
  });

  it("rejects a write to an entity after its tombstone is compacted", async () => {
    const store = createMemorySyncStore();
    await seedDevice(store, "ws-1", "device-a", NOW);
    await store.putTombstone({
      tombstoneId: "tombstone-1",
      workspaceId: "ws-1",
      entityType: "note",
      entityId: "note-1",
      deletedAt: NOW,
      deletedByDeviceId: "device-a",
      tombstoneWorkspaceRevision: 1,
      state: "compacted",
      compactedAt: NOW,
    });

    await expect(
      recordSyncChanges(store, {
        changes: [
          change({
            fieldPatches: { title: "Recreated" },
            opId: "op-recreate",
            at: NOW,
          }),
        ],
      })
    ).rejects.toMatchObject({ code: "tombstoned_entity" });
  });

  it("does not claim a global workspace revision", async () => {
    const localStore = createMemorySyncStore();
    const remoteStore = createMemorySyncStore();
    await seedDevice(localStore, "ws-1", "device-a", NOW);
    await seedDevice(remoteStore, "ws-1", "device-b", NOW);

    await recordSyncChanges(localStore, {
      changes: [
        change({
          fieldPatches: { title: "Title A" },
          opId: "op-a",
          at: NOW,
        }),
      ],
    });
    await recordSyncChanges(remoteStore, {
      changes: [
        change({
          fieldPatches: { pinned: true },
          opId: "op-b",
          at: NOW,
        }),
      ],
    });

    expect(await localStore.getWorkspaceState("ws-1", "device-a")).toMatchObject({
      lastLocalWorkspaceRevision: 1,
    });
    expect(await remoteStore.getWorkspaceState("ws-1", "device-b")).toMatchObject({
      lastLocalWorkspaceRevision: 1,
    });
  });
});
