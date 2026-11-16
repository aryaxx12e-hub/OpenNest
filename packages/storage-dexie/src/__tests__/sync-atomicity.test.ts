import "fake-indexeddb/auto";

import type { BackupSnapshot } from "@opennest/core";
import { prepareSyncChanges, type SyncPolicy } from "@opennest/sync";
import { afterEach, describe, expect, it } from "vitest";

import { createDexieStorage } from "../index";

const AT = "2026-11-15T10:00:00.000Z" as never;
const AT2 = "2026-11-15T10:01:00.000Z" as never;
const AT3 = "2026-11-15T10:02:00.000Z" as never;
const open: Array<Awaited<ReturnType<typeof createDexieStorage>>> = [];

function databaseName(label: string): string {
  return `opennest-sync-atomicity-${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function makeStorage(
  label: string,
  policy?: SyncPolicy
): Promise<Awaited<ReturnType<typeof createDexieStorage>>> {
  const storage = createDexieStorage({
    databaseName: databaseName(label),
    ...(policy === undefined ? {} : { syncPolicy: policy }),
  });
  await storage.init();
  open.push(storage);

  return storage;
}

afterEach(async () => {
  await Promise.all(open.splice(0).map((storage) => storage.close()));
});

describe("Dexie sync atomicity", () => {
  it("records create, update, and delete metadata", async () => {
    const storage = await makeStorage("metadata");
    const workspace = await storage.workspaces.ensureWorkspace({ at: AT });
    const note = await storage.notes.create({
      workspaceId: workspace.id,
      folderId: null,
      title: "Judul",
      content: "Isi",
      pinned: false,
      at: AT,
    });

    expect(await storage.sync.getEntityMeta(workspace.id, "note", note.id)).toMatchObject(
      { entityRevision: 1, deletedAt: null }
    );
    const createdFields = await storage.sync.listFieldMeta(workspace.id);
    expect(
      createdFields
        .filter((row) => row.entityId === note.id)
        .map((row) => row.fieldPath)
        .sort()
    ).toEqual(
      ["content", "folderId", "pinned", "tagIds", "targetNoteIds", "title"].sort()
    );

    await storage.notes.update(note.id, { title: "Baru", at: AT2 });

    expect(await storage.sync.getEntityMeta(workspace.id, "note", note.id)).toMatchObject(
      { entityRevision: 2, workspaceRevision: 3 }
    );
    expect(
      await storage.sync.getFieldMeta(workspace.id, "note", note.id, "title")
    ).toMatchObject({ fieldRevision: 2 });
    expect(
      await storage.sync.getFieldMeta(workspace.id, "note", note.id, "content")
    ).toMatchObject({ fieldRevision: 1 });

    await storage.notes.update(note.id, { content: "Baru", at: AT3 });
    await storage.notes.delete(note.id);
    const meta = await storage.sync.getEntityMeta(workspace.id, "note", note.id);
    expect(meta?.deletedAt).not.toBeNull();
    expect(await storage.sync.listTombstones(workspace.id)).toMatchObject([
      { entityId: note.id, state: "active" },
    ]);
  });

  it("tracks workspace revisions independently in one transaction", async () => {
    const storage = await makeStorage("workspace-revisions");
    const first = await storage.workspaces.create({ name: "One", at: AT });
    const second = await storage.workspaces.create({ name: "Two", at: AT });
    await storage.notes.create({
      workspaceId: first.id,
      folderId: null,
      title: "First extra",
      content: "",
      at: AT,
    });

    const [firstNote, secondNote] = await storage.transaction(async (tx) => [
      await tx.notes.create({
        workspaceId: first.id,
        folderId: null,
        title: "First",
        content: "",
        at: AT2,
      }),
      await tx.notes.create({
        workspaceId: second.id,
        folderId: null,
        title: "Second",
        content: "",
        at: AT2,
      }),
    ]);

    expect(
      await storage.sync.getEntityMeta(first.id, "note", firstNote.id)
    ).toMatchObject({ workspaceRevision: 3 });
    expect(
      await storage.sync.getEntityMeta(second.id, "note", secondNote.id)
    ).toMatchObject({ workspaceRevision: 2 });
  });

  it("records folder delete cascade patches in one workspace revision", async () => {
    const storage = await makeStorage("folder-cascade");
    const workspace = await storage.workspaces.ensureWorkspace({ at: AT });
    const root = await storage.folders.create({
      workspaceId: workspace.id,
      parentId: null,
      name: "Akar",
      at: AT,
    });
    const child = await storage.folders.create({
      workspaceId: workspace.id,
      parentId: root.id,
      name: "Anak",
      at: AT,
    });
    const file = await storage.files.create({
      workspaceId: workspace.id,
      folderId: root.id,
      name: "Catatan.pdf",
      mimeType: "application/pdf",
      sizeBytes: 2,
      blobKey: "blob-1" as never,
      checksum: "checksum-1",
      at: AT,
    });
    const note = await storage.notes.create({
      workspaceId: workspace.id,
      folderId: root.id,
      title: "Halo",
      content: "Isi",
      at: AT,
    });

    await storage.folders.delete(root.id);

    expect((await storage.folders.get(child.id))?.parentId).toBeNull();
    expect((await storage.files.get(file.id))?.folderId).toBeNull();
    expect((await storage.notes.get(note.id))?.folderId).toBeNull();

    const revisions = await Promise.all(
      [
        ["folder", root.id],
        ["folder", child.id],
        ["file", file.id],
        ["note", note.id],
      ].map(
        async ([entityType, entityId]) =>
          (
            await storage.sync.getEntityMeta(
              workspace.id,
              entityType as "folder" | "file" | "note",
              entityId as string
            )
          )?.workspaceRevision
      )
    );
    expect(new Set(revisions).size).toBe(1);
    expect(revisions[0]).not.toBeUndefined();
  });

  it("records tag delete and note delete relation patches", async () => {
    const storage = await makeStorage("relation-delete");
    const workspace = await storage.workspaces.ensureWorkspace({ at: AT });
    const first = await storage.notes.create({
      workspaceId: workspace.id,
      folderId: null,
      title: "Satu",
      content: "",
      at: AT,
    });
    const second = await storage.notes.create({
      workspaceId: workspace.id,
      folderId: null,
      title: "Dua",
      content: "",
      at: AT,
    });
    const tag = await storage.tags.create({
      workspaceId: workspace.id,
      name: "penting",
      at: AT,
    });
    await storage.notes.setTags(first.id, [tag.id]);
    await storage.notes.setTags(second.id, [tag.id]);

    await storage.tags.delete(tag.id);

    expect(await storage.notes.tags(first.id)).toEqual([]);
    expect(await storage.notes.tags(second.id)).toEqual([]);
    const tagDeleteRevision = (
      await storage.sync.getEntityMeta(workspace.id, "tag", tag.id)
    )?.workspaceRevision;
    expect(
      await storage.sync.getFieldMeta(workspace.id, "note", first.id, "tagIds")
    ).toMatchObject({ workspaceRevision: tagDeleteRevision });
    expect(
      await storage.sync.getFieldMeta(workspace.id, "note", second.id, "tagIds")
    ).toMatchObject({ workspaceRevision: tagDeleteRevision });

    const source = await storage.notes.create({
      workspaceId: workspace.id,
      folderId: null,
      title: "Sumber",
      content: "",
      at: AT,
    });
    const target = await storage.notes.create({
      workspaceId: workspace.id,
      folderId: null,
      title: "Target",
      content: "",
      at: AT,
    });
    await storage.notes.setLinks(source.id, [target.id]);

    await storage.notes.delete(target.id);

    expect(await storage.notes.links(source.id)).toEqual([]);
    expect(
      await storage.sync.getFieldMeta(workspace.id, "note", source.id, "targetNoteIds")
    ).toMatchObject({ fieldRevision: 3 });
  });

  it("canonicalizes relation arrays across reordered writes", async () => {
    const policy: SyncPolicy = {
      outbox: { enabled: true, maxRows: 100, retentionMs: 86_400_000 },
    };
    const storage = await makeStorage("canonical", policy);
    const workspace = await storage.workspaces.ensureWorkspace({ at: AT });
    const note = await storage.notes.create({
      workspaceId: workspace.id,
      folderId: null,
      title: "Catatan",
      content: "",
      at: AT,
    });
    const alpha = await storage.tags.create({
      workspaceId: workspace.id,
      name: "alpha",
      at: AT,
    });
    const beta = await storage.tags.create({
      workspaceId: workspace.id,
      name: "beta",
      at: AT,
    });
    const expected = [alpha.id, beta.id].sort();

    await storage.notes.setTags(note.id, [beta.id, alpha.id]);
    await storage.notes.setTags(note.id, [alpha.id, beta.id]);

    const rows = (await storage.sync.listOutbox(workspace.id)).filter(
      (row) =>
        row.entityId === note.id &&
        row.operation === "update" &&
        Array.isArray(row.fieldPatches.tagIds)
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]?.fieldPatches.tagIds).toEqual(expected);
    expect(rows[1]?.fieldPatches.tagIds).toEqual(expected);

    const base = {
      workspaceId: workspace.id,
      entityType: "note" as const,
      entityId: note.id,
      operation: "update" as const,
      at: AT as string,
      contentHash: null,
      opId: "fixed-op",
    };
    const [reordered] = await prepareSyncChanges({
      changes: [{ ...base, fieldPatches: { tagIds: [beta.id, alpha.id] } }],
    });
    const [ordered] = await prepareSyncChanges({
      changes: [{ ...base, fieldPatches: { tagIds: [alpha.id, beta.id] } }],
    });
    expect(reordered?.payloadHash).toBe(ordered?.payloadHash);
  });

  it("writes no outbox rows with the default policy", async () => {
    const storage = await makeStorage("default-outbox");
    const workspace = await storage.workspaces.ensureWorkspace({ at: AT });
    await storage.notes.create({
      workspaceId: workspace.id,
      folderId: null,
      title: "Tanpa outbox",
      content: "",
      at: AT,
    });

    expect(await storage.sync.listOutbox(workspace.id)).toEqual([]);
  });

  it("writes immutable outbox rows when enabled", async () => {
    const storage = await makeStorage("enabled-outbox", {
      outbox: { enabled: true, maxRows: 100, retentionMs: 86_400_000 },
    });
    const workspace = await storage.workspaces.ensureWorkspace({ at: AT });
    const note = await storage.notes.create({
      workspaceId: workspace.id,
      folderId: null,
      title: "Dengan outbox",
      content: "",
      at: AT,
    });

    const rows = (await storage.sync.listOutbox(workspace.id)).filter(
      (row) => row.entityId === note.id
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ operation: "create", attempts: 0 });
    expect(rows[0]?.payloadHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("clears every sidecar on reset", async () => {
    const storage = await makeStorage("reset-sidecars");
    const workspace = await storage.workspaces.ensureWorkspace({ at: AT });
    const note = await storage.notes.create({
      workspaceId: workspace.id,
      folderId: null,
      title: "Hapus",
      content: "",
      at: AT,
    });
    const tag = await storage.tags.create({
      workspaceId: workspace.id,
      name: "sementara",
      at: AT,
    });
    await storage.notes.setTags(note.id, [tag.id]);
    await storage.notes.delete(note.id);
    await storage.tags.delete(tag.id);
    expect(await storage.sync.listTombstones(workspace.id)).not.toEqual([]);

    await storage.reset();

    expect(await storage.sync.listEntityMeta(workspace.id)).toEqual([]);
    expect(await storage.sync.listFieldMeta(workspace.id)).toEqual([]);
    expect(await storage.sync.listTombstones(workspace.id)).toEqual([]);
    expect(await storage.sync.listDevices(workspace.id)).toEqual([]);
    expect(await storage.sync.listOutbox(workspace.id)).toEqual([]);
    expect(await storage.sync.listConflicts(workspace.id)).toEqual([]);
  });

  it("clears stale tombstones and backfills restored entities", async () => {
    const storage = await makeStorage("restore-backfill");
    const workspace = await storage.workspaces.ensureWorkspace({ at: AT });
    const note = await storage.notes.create({
      workspaceId: workspace.id,
      folderId: null,
      title: "Lama",
      content: "",
      at: AT,
    });
    await storage.notes.delete(note.id);

    const restoredWorkspaceId = "77777777-7777-4777-8777-777777777777";
    const snapshot: BackupSnapshot = {
      snapshotVersion: 1,
      schemaVersion: 1,
      kind: "dexie",
      createdAt: AT,
      workspace: {
        id: restoredWorkspaceId as never,
        name: "Pulih",
        createdAt: AT,
        updatedAt: AT,
      },
      folders: [],
      files: [],
      notes: [
        {
          id: "88888888-8888-4888-8888-888888888888" as never,
          workspaceId: restoredWorkspaceId as never,
          folderId: null,
          title: "Baru",
          content: "Isi",
          pinned: true,
          createdAt: AT,
          updatedAt: AT,
        },
      ],
      tags: [],
      fileTags: [],
      noteTags: [],
      noteLinks: [],
      blobs: [],
    };

    await storage.restore(snapshot);

    expect(await storage.sync.listTombstones(restoredWorkspaceId)).toEqual([]);
    expect(await storage.sync.listEntityMeta(restoredWorkspaceId)).toHaveLength(2);
    expect(
      await storage.sync.getFieldMeta(
        restoredWorkspaceId,
        "note",
        "88888888-8888-4888-8888-888888888888",
        "title"
      )
    ).toMatchObject({ fieldRevision: 1 });
    expect(await storage.sync.listDevices(restoredWorkspaceId)).toHaveLength(1);
  });

  it("preserves the local sequence high-water across restore", async () => {
    const storage = await makeStorage("restore-high-water");
    const workspace = await storage.workspaces.ensureWorkspace({ at: AT });
    const device = await storage.sync.getOrCreateDevice(workspace.id, AT);
    const state = await storage.sync.getOrCreateWorkspaceState(
      workspace.id,
      device.deviceId,
      AT
    );
    await storage.sync.putWorkspaceState({
      ...state,
      lastLocalSequence: 4,
    });

    await storage.restore({
      snapshotVersion: 1,
      schemaVersion: 1,
      kind: "dexie",
      createdAt: AT,
      workspace: {
        id: workspace.id,
        name: "Pulih",
        createdAt: workspace.createdAt,
        updatedAt: workspace.updatedAt,
      },
      folders: [],
      files: [],
      notes: [],
      tags: [],
      fileTags: [],
      noteTags: [],
      noteLinks: [],
      blobs: [],
    });

    const [restoredDevice] = await storage.sync.listDevices(workspace.id);
    expect(restoredDevice?.deviceId).toBe(device.deviceId);
    expect(
      await storage.sync.getWorkspaceState(workspace.id, device.deviceId)
    ).toMatchObject({ lastLocalSequence: 4 });
    expect(await storage.sync.nextLocalSequence(workspace.id, device.deviceId)).toBe(5);
  });

  it("preserves a file checksum when a tag is deleted", async () => {
    const storage = await makeStorage("tag-checksum");
    const workspace = await storage.workspaces.ensureWorkspace({ at: AT });
    const file = await storage.files.create({
      workspaceId: workspace.id,
      folderId: null,
      name: "Catatan.pdf",
      mimeType: "application/pdf",
      sizeBytes: 2,
      blobKey: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" as never,
      checksum: "checksum-1",
      at: AT,
    });
    const tag = await storage.tags.create({
      workspaceId: workspace.id,
      name: "penting",
      at: AT,
    });
    await storage.files.setTags(file.id, [tag.id]);

    await storage.tags.delete(tag.id);

    expect(await storage.sync.getEntityMeta(workspace.id, "file", file.id)).toMatchObject(
      { contentHash: "checksum-1" }
    );
  });

  it("blocks restore when a remote target exists", async () => {
    const storage = await makeStorage("restore-remote");
    const workspace = await storage.workspaces.ensureWorkspace({ at: AT });
    const note = await storage.notes.create({
      workspaceId: workspace.id,
      folderId: null,
      title: "Tetap",
      content: "",
      at: AT,
    });
    const device = await storage.sync.getOrCreateDevice(workspace.id, AT);
    const state = await storage.sync.getOrCreateWorkspaceState(
      workspace.id,
      device.deviceId,
      AT
    );
    await storage.sync.putWorkspaceState({
      ...state,
      remoteWorkspaceId: "remote-1",
    });

    await expect(
      storage.restore({
        snapshotVersion: 1,
        schemaVersion: 1,
        kind: "dexie",
        createdAt: AT,
        workspace: {
          id: "99999999-9999-4999-8999-999999999999" as never,
          name: "Lain",
          createdAt: AT,
          updatedAt: AT,
        },
        folders: [],
        files: [],
        notes: [],
        tags: [],
        fileTags: [],
        noteTags: [],
        noteLinks: [],
        blobs: [],
      })
    ).rejects.toMatchObject({ code: "remote_target_present" });

    expect(await storage.workspaces.get(workspace.id)).not.toBeNull();
    expect(await storage.notes.get(note.id)).not.toBeNull();
    expect(
      await storage.sync.getWorkspaceState(workspace.id, device.deviceId)
    ).toMatchObject({ remoteWorkspaceId: "remote-1" });
  });

  it("aborts the outer transaction when a nested sync write fails", async () => {
    const name = databaseName("nested-abort");
    const first = createDexieStorage({ databaseName: name });
    await first.init();
    const workspace = await first.workspaces.ensureWorkspace({ at: AT });
    await first.close();

    const storage = createDexieStorage({
      databaseName: name,
      syncPolicy: {
        outbox: { enabled: true, maxRows: 0, retentionMs: 86_400_000 },
      },
    });
    await storage.init();
    open.push(storage);

    await expect(
      storage.transaction(async (tx) => {
        try {
          await tx.notes.create({
            workspaceId: workspace.id,
            folderId: null,
            title: "Tidak boleh tersimpan",
            content: "",
            at: AT2,
          });
        } catch {
          // The outer transaction must still abort.
        }

        return "lanjut";
      })
    ).rejects.toBeDefined();

    expect((await storage.notes.list(workspace.id, {}, {})).items).toEqual([]);
  });

  it("rolls back the entity write when the outbox is full", async () => {
    const name = databaseName("outbox-full");
    const first = createDexieStorage({ databaseName: name });
    await first.init();
    const workspace = await first.workspaces.ensureWorkspace({ at: AT });
    await first.close();

    const storage = createDexieStorage({
      databaseName: name,
      syncPolicy: {
        outbox: { enabled: true, maxRows: 0, retentionMs: 86_400_000 },
      },
    });
    await storage.init();
    open.push(storage);

    await expect(
      storage.notes.create({
        workspaceId: workspace.id,
        folderId: null,
        title: "Gagal",
        content: "",
        at: AT,
      })
    ).rejects.toMatchObject({ code: "outbox_full" });
    expect((await storage.notes.list(workspace.id, {}, {})).items).toEqual([]);
  });
});
