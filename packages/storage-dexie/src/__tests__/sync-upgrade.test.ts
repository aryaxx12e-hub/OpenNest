import "fake-indexeddb/auto";

import Dexie from "dexie";
import { describe, expect, it } from "vitest";

import { createDexieStorage } from "../index";
import { OpenNestDexie } from "../schema";

const AT = "2026-11-15T10:00:00.000Z";

function databaseName(label: string): string {
  return `opennest-sync-upgrade-${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const V2_SCHEMA = {
  workspaces: "id",
  folders:
    "id, workspaceId, parentId, [workspaceId+parentId], " +
    "[workspaceId+name+id], [workspaceId+createdAt+id], [workspaceId+updatedAt+id]",
  files:
    "id, workspaceId, folderId, [workspaceId+folderId], " +
    "[workspaceId+name+id], [workspaceId+createdAt+id], [workspaceId+updatedAt+id]",
  notes:
    "id, workspaceId, folderId, [workspaceId+folderId], pinned, " +
    "[workspaceId+title+id], [workspaceId+createdAt+id], [workspaceId+updatedAt+id]",
  tags: "id, workspaceId, &[workspaceId+name], [workspaceId+createdAt+id]",
  fileTags: "[fileId+tagId], fileId, tagId",
  noteTags: "[noteId+tagId], noteId, tagId",
  noteLinks: "[sourceNoteId+targetNoteId], sourceNoteId, targetNoteId",
  blobs: "key",
};

const V3_SCHEMA = {
  ...V2_SCHEMA,
  sync_meta: "[workspaceId+entityType+entityId], [workspaceId+workspaceRevision]",
  sync_field_meta:
    "[workspaceId+entityType+entityId+fieldPath], " + "[workspaceId+entityType+entityId]",
  sync_outbox:
    "opId, &[workspaceId+deviceId+localSequence], " +
    "[workspaceId+deviceId+state+localSequence]",
  workspace_sync_state: "[workspaceId+deviceId]",
  sync_tombstone:
    "[workspaceId+entityType+entityId], " + "[workspaceId+tombstoneWorkspaceRevision]",
  sync_conflict: "conflictId, [workspaceId+entityId+state]",
  sync_devices: "[workspaceId+deviceId], [workspaceId+state]",
};

async function seedVersionThreeWithOutbox(name: string): Promise<void> {
  const legacy = new Dexie(name);
  legacy.version(3).stores(V3_SCHEMA);
  await legacy.open();

  await legacy.table("workspaces").put({
    id: "workspace-1",
    name: "Rumah",
    createdAt: AT,
    updatedAt: AT,
  });
  await legacy.table("workspace_sync_state").put({
    workspaceId: "workspace-1",
    deviceId: "legacy",
    remoteWorkspaceId: null,
    lastServerCursor: null,
    lastLocalWorkspaceRevision: 3,
    tombstoneFloor: 0,
    lastFullResyncAt: null,
  });
  await legacy.table("sync_outbox").put({
    opId: "op-1",
    workspaceId: "workspace-1",
    entityType: "note",
    entityId: "note-1",
    operation: "create",
    baseEntityRevision: 0,
    baseWorkspaceRevision: 0,
    fieldPatches: {},
    payloadHash: "a".repeat(64),
    createdAt: AT,
    deviceId: "legacy",
    localSequence: 4,
    attempts: 0,
    state: "pending",
    ackedAt: null,
  });

  legacy.close();
}

async function seedVersionTwo(name: string): Promise<void> {
  const legacy = new Dexie(name);
  legacy.version(2).stores(V2_SCHEMA);
  await legacy.open();

  await legacy.table("workspaces").put({
    id: "workspace-1",
    name: "Rumah",
    createdAt: AT,
    updatedAt: AT,
  });
  await legacy.table("folders").put({
    id: "folder-1",
    workspaceId: "workspace-1",
    parentId: null,
    name: "Akar",
    createdAt: AT,
    updatedAt: AT,
  });
  await legacy.table("files").put({
    id: "file-1",
    workspaceId: "workspace-1",
    folderId: "folder-1",
    name: "Catatan.pdf",
    mimeType: "application/pdf",
    sizeBytes: 2,
    blobKey: "blob-1",
    checksum: "checksum-1",
    createdAt: AT,
    updatedAt: AT,
  });
  await legacy.table("notes").put({
    id: "note-1",
    workspaceId: "workspace-1",
    folderId: null,
    title: "Halo",
    content: "Isi",
    pinned: 0,
    createdAt: AT,
    updatedAt: AT,
  });
  await legacy.table("tags").put({
    id: "tag-1",
    workspaceId: "workspace-1",
    name: "penting",
    color: "#111111",
    createdAt: AT,
  });
  await legacy.table("blobs").put({
    key: "blob-1",
    type: "application/pdf",
    size: 2,
    data: new Uint8Array([1, 2]),
  });

  legacy.close();
}

describe("sync schema upgrade", () => {
  it("backfills the local sequence high-water from version 3", async () => {
    const name = databaseName("high-water");
    await seedVersionThreeWithOutbox(name);

    const storage = createDexieStorage({ databaseName: name });
    await storage.init();
    expect(storage.schemaVersion).toBe(3);

    const [device] = await storage.sync.listDevices("workspace-1");
    expect(device).toBeDefined();
    expect(
      await storage.sync.getWorkspaceState("workspace-1", device!.deviceId)
    ).toMatchObject({ lastLocalSequence: 4 });
    expect(await storage.sync.nextLocalSequence("workspace-1", device!.deviceId)).toBe(5);

    await storage.close();
  });

  it("backfills sync metadata and bootstraps the installation device", async () => {
    const name = databaseName("backfill");
    await seedVersionTwo(name);

    const storage = createDexieStorage({ databaseName: name });
    await storage.init();
    expect(storage.schemaVersion).toBe(3);
    await storage.close();

    const reopened = new OpenNestDexie(name);
    await reopened.open();

    expect(reopened.verno).toBe(4);
    expect(await reopened.table("sync_meta").count()).toBe(5);
    expect(await reopened.table("workspace_sync_state").count()).toBe(1);
    expect(await reopened.table("sync_devices").count()).toBe(1);

    const state = await reopened.table("workspace_sync_state").toArray();
    expect(state[0]!.deviceId).not.toBe("legacy");
    const meta = await reopened.table("sync_meta").toArray();
    expect(meta.every((row) => row.originDeviceId === state[0]!.deviceId)).toBe(true);

    const fileMeta = meta.find((row) => row.entityType === "file");
    expect(fileMeta).toMatchObject({
      entityRevision: 1,
      workspaceRevision: 0,
      contentHash: "checksum-1",
    });

    reopened.close();
  });
});
