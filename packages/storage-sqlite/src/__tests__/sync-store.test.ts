// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type {
  SyncConflictRow,
  SyncFieldMetaRow,
  SyncMetaRow,
  SyncOutboxRow,
  SyncTombstoneRow,
} from "@opennest/sync";
import { afterEach, describe, expect, it } from "vitest";

import { createSqliteStorage } from "../index";

const AT = "2026-11-15T10:00:00.000Z" as never;
const directories: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "opennest-sqlite-sync-"));
  directories.push(root);

  return root;
}

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

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
    remoteValue: { text: "remote" },
    localDeviceId: "device-a",
    remoteDeviceId: "device-b",
    createdAt: AT,
    state: "open",
    resolution: "local",
    resolvedAt: null,
    resolvedByDeviceId: null,
  };
}

describe("SQLite sync store", () => {
  it("round-trips every sidecar row", async () => {
    const root = await makeRoot();
    const storage = createSqliteStorage({
      databaseFile: path.join(root, "database.sqlite"),
      blobRoot: path.join(root, "blobs"),
    });
    await storage.init();
    const workspace = await storage.workspaces.ensureWorkspace({ at: AT });
    const device = await storage.sync.getOrCreateDevice(workspace.id, AT);
    const state = await storage.sync.getOrCreateWorkspaceState(
      workspace.id,
      device.deviceId,
      AT
    );

    await storage.sync.putWorkspaceState({
      ...state,
      lastLocalWorkspaceRevision: 1,
    });
    await storage.sync.putEntityMeta(meta(workspace.id, "note-1"));
    await storage.sync.putFieldMeta(field(workspace.id, "note-1"));
    await storage.sync.appendOutbox(outbox(workspace.id, "op-1", device.deviceId, 1));
    await storage.sync.putTombstone(tombstone(workspace.id, "note-2"));
    await storage.sync.putConflict(conflict(workspace.id, "conflict-1"));

    expect(await storage.sync.listDevices(workspace.id)).toHaveLength(1);
    expect(
      await storage.sync.getWorkspaceState(workspace.id, device.deviceId)
    ).toMatchObject({ lastLocalWorkspaceRevision: 1 });
    expect(
      await storage.sync.getEntityMeta(workspace.id, "note", "note-1")
    ).toMatchObject({ entityRevision: 1 });
    expect(
      await storage.sync.getFieldMeta(workspace.id, "note", "note-1", "title")
    ).toMatchObject({ fieldRevision: 1 });
    expect(await storage.sync.listOutbox(workspace.id)).toMatchObject([
      { opId: "op-1", fieldPatches: { title: "Hello" } },
    ]);
    expect(await storage.sync.listTombstones(workspace.id)).toHaveLength(1);
    expect(await storage.sync.listConflicts(workspace.id, "open")).toMatchObject([
      { conflictId: "conflict-1", remoteValue: { text: "remote" } },
    ]);

    const resolved = await storage.sync.resolveConflict("conflict-1", {
      resolution: "remote",
      resolvedAt: AT,
      resolvedByDeviceId: device.deviceId,
    });
    expect(resolved).toMatchObject({
      state: "resolved",
      resolution: "remote",
    });

    await storage.close();
  });

  it("advances the high-water mark and rejects duplicate opIds", async () => {
    const root = await makeRoot();
    const storage = createSqliteStorage({
      databaseFile: path.join(root, "database.sqlite"),
      blobRoot: path.join(root, "blobs"),
    });
    await storage.init();
    const workspace = await storage.workspaces.ensureWorkspace({ at: AT });
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

  it("reports schemaVersion 4", async () => {
    const root = await makeRoot();
    const storage = createSqliteStorage({
      databaseFile: path.join(root, "database.sqlite"),
      blobRoot: path.join(root, "blobs"),
    });
    await storage.init();

    expect(storage.schemaVersion).toBe(4);

    await storage.close();
  });
});
