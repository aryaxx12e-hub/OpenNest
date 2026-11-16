import "fake-indexeddb/auto";

import type {
  SyncConflictRow,
  SyncFieldMetaRow,
  SyncMetaRow,
  SyncOutboxRow,
  SyncTombstoneRow,
} from "@opennest/sync";
import { describe, expect, it } from "vitest";

import { createDexieStorage } from "../index";

const AT = "2026-11-15T10:00:00.000Z" as never;

function databaseName(label: string): string {
  return `opennest-sync-${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function meta(workspaceId: string, entityId: string): SyncMetaRow {
  return {
    workspaceId,
    entityType: "note",
    entityId,
    entityRevision: 1,
    workspaceRevision: 1,
    originDeviceId: "device-1",
    updatedAt: AT,
    deletedAt: null,
    contentHash: null,
  };
}

function field(workspaceId: string, entityId: string): SyncFieldMetaRow {
  return {
    workspaceId,
    entityType: "note",
    entityId,
    fieldPath: "title",
    fieldRevision: 1,
    workspaceRevision: 1,
    originDeviceId: "device-1",
    updatedAt: AT,
    deletedAt: null,
  };
}

function outbox(
  workspaceId: string,
  opId: string,
  deviceId: string,
  localSequence: number
): SyncOutboxRow {
  return {
    opId,
    workspaceId,
    entityType: "note",
    entityId: "note-1",
    operation: "create",
    baseEntityRevision: 0,
    baseWorkspaceRevision: 0,
    fieldPatches: { title: "Hello" },
    payloadHash: "a".repeat(64),
    createdAt: AT,
    deviceId,
    localSequence,
    attempts: 0,
    state: "pending",
    ackedAt: null,
  };
}

function tombstone(workspaceId: string, entityId: string): SyncTombstoneRow {
  return {
    tombstoneId: `tombstone-${entityId}`,
    workspaceId,
    entityType: "note",
    entityId,
    deletedAt: AT,
    deletedByDeviceId: "device-1",
    tombstoneWorkspaceRevision: 1,
    state: "active",
    compactedAt: null,
  };
}

function conflict(workspaceId: string, conflictId: string): SyncConflictRow {
  return {
    conflictId,
    workspaceId,
    entityType: "note",
    entityId: "note-1",
    fieldPath: "content",
    localFieldRevision: 1,
    remoteFieldRevision: 1,
    localOpId: "op-local",
    remoteOpId: "op-remote",
    localValue: "local",
    remoteValue: "remote",
    localDeviceId: "device-a",
    remoteDeviceId: "device-b",
    createdAt: AT,
    state: "open",
    resolution: "local",
    resolvedAt: null,
    resolvedByDeviceId: null,
  };
}

describe("Dexie sync store", () => {
  it("creates a device and workspace state on init", async () => {
    const name = databaseName("init");
    const first = createDexieStorage({ databaseName: name });
    await first.init();
    const workspace = await first.workspaces.create({ name: "Rumah", at: AT });
    await first.close();

    const storage = createDexieStorage({ databaseName: name });
    await storage.init();

    const devices = await storage.sync.listDevices(workspace.id);
    expect(devices).toHaveLength(1);
    expect(devices[0]?.deviceId).not.toBe("legacy");
    expect(
      await storage.sync.getWorkspaceState(workspace.id, devices[0]!.deviceId)
    ).toMatchObject({
      workspaceId: workspace.id,
      deviceId: devices[0]!.deviceId,
      lastLocalWorkspaceRevision: 1,
      lastLocalSequence: 0,
    });

    await storage.close();
  });

  it("round-trips entity, field, outbox, tombstone, and conflict rows", async () => {
    const storage = createDexieStorage({ databaseName: databaseName("roundtrip") });
    await storage.init();
    const workspace = await storage.workspaces.create({ name: "Rumah", at: AT });
    const device = await storage.sync.getOrCreateDevice(workspace.id, AT);
    await storage.sync.getOrCreateWorkspaceState(workspace.id, device.deviceId, AT);

    await storage.sync.putEntityMeta(meta(workspace.id, "note-1"));
    await storage.sync.putFieldMeta(field(workspace.id, "note-1"));
    await storage.sync.appendOutbox(outbox(workspace.id, "op-1", device.deviceId, 1));
    await storage.sync.putTombstone(tombstone(workspace.id, "note-2"));
    await storage.sync.putConflict(conflict(workspace.id, "conflict-1"));

    expect(
      await storage.sync.getEntityMeta(workspace.id, "note", "note-1")
    ).toMatchObject({ entityRevision: 1 });
    expect(
      await storage.sync.getFieldMeta(workspace.id, "note", "note-1", "title")
    ).toMatchObject({ fieldRevision: 1 });
    expect(await storage.sync.listOutbox(workspace.id)).toHaveLength(1);
    expect(await storage.sync.listTombstones(workspace.id)).toHaveLength(1);
    expect(await storage.sync.listConflicts(workspace.id, "open")).toHaveLength(1);

    await storage.close();
  });

  it("clears only the requested workspace", async () => {
    const storage = createDexieStorage({ databaseName: databaseName("clear") });
    await storage.init();
    const first = await storage.workspaces.create({ name: "One", at: AT });
    const second = await storage.workspaces.create({ name: "Two", at: AT });
    await storage.sync.putEntityMeta(meta(first.id, "note-1"));
    await storage.sync.putEntityMeta(meta(second.id, "note-2"));

    await storage.sync.clearWorkspace(first.id);

    expect(await storage.sync.listEntityMeta(first.id)).toEqual([]);
    expect(await storage.sync.listEntityMeta(second.id)).toHaveLength(2);

    await storage.close();
  });

  it("advances the high-water mark and rejects duplicate opIds", async () => {
    const storage = createDexieStorage({ databaseName: databaseName("high-water") });
    await storage.init();
    const workspace = await storage.workspaces.create({ name: "Rumah", at: AT });
    const device = await storage.sync.getOrCreateDevice(workspace.id, AT);
    await storage.sync.getOrCreateWorkspaceState(workspace.id, device.deviceId, AT);

    await storage.sync.appendOutbox(outbox(workspace.id, "op-1", device.deviceId, 1));
    expect(
      await storage.sync.getWorkspaceState(workspace.id, device.deviceId)
    ).toMatchObject({ lastLocalSequence: 1 });
    await expect(
      storage.sync.appendOutbox(outbox(workspace.id, "op-1", device.deviceId, 2))
    ).rejects.toMatchObject({ code: "invalid_sync_state" });
    expect(await storage.sync.listOutbox(workspace.id)).toMatchObject([
      { opId: "op-1", localSequence: 1 },
    ]);

    await storage.sync.deleteOutbox("op-1");
    expect(await storage.sync.nextLocalSequence(workspace.id, device.deviceId)).toBe(2);
    await storage.sync.appendOutbox(outbox(workspace.id, "op-2", device.deviceId, 2));
    expect(await storage.sync.listOutbox(workspace.id)).toMatchObject([
      { opId: "op-2", localSequence: 2 },
    ]);

    await storage.close();
  });

  it("scopes localSequence per workspace and device", async () => {
    const storage = createDexieStorage({
      databaseName: databaseName("sequence"),
    });
    await storage.init();
    const first = await storage.workspaces.create({ name: "One", at: AT });
    const second = await storage.workspaces.create({ name: "Two", at: AT });
    const firstDevice = await storage.sync.getOrCreateDevice(first.id, AT);
    const secondDevice = await storage.sync.getOrCreateDevice(second.id, AT);
    expect(secondDevice.deviceId).toBe(firstDevice.deviceId);

    expect(await storage.sync.nextLocalSequence(first.id, firstDevice.deviceId)).toBe(1);
    await storage.sync.appendOutbox(outbox(first.id, "op-1", firstDevice.deviceId, 1));
    expect(await storage.sync.nextLocalSequence(first.id, firstDevice.deviceId)).toBe(2);
    expect(await storage.sync.nextLocalSequence(second.id, secondDevice.deviceId)).toBe(
      1
    );

    await storage.close();
  });
});
