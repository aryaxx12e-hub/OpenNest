import { describe, expect, it } from "vitest";

import type { BackupSnapshot } from "@opennest/core";
import {
  recordSyncChanges,
  type SyncCapableStorage,
  type SyncConflictRow,
  type SyncPolicy,
} from "@opennest/sync";

const AT = "2026-11-15T10:00:00.000Z" as never;
const AT2 = "2026-11-15T10:01:00.000Z" as never;

export type SyncStorageFactory = (
  name?: string,
  policy?: SyncPolicy
) => Promise<SyncCapableStorage>;

async function withSync<T>(
  create: SyncStorageFactory,
  run: (storage: SyncCapableStorage) => Promise<T>,
  policy?: SyncPolicy
): Promise<T> {
  const storage = await create(undefined, policy);
  await storage.init();

  try {
    return await run(storage);
  } finally {
    await storage.close();
  }
}

const enabled: SyncPolicy = {
  outbox: { enabled: true, maxRows: 1000, retentionMs: 86_400_000 },
};

function suffix(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function snapshot(
  workspaceId: string,
  noteId: string,
  kind: BackupSnapshot["kind"]
): BackupSnapshot {
  return {
    snapshotVersion: 1,
    schemaVersion: 1,
    kind,
    createdAt: AT,
    workspace: {
      id: workspaceId as never,
      name: "Pulih",
      createdAt: AT,
      updatedAt: AT,
    },
    folders: [],
    files: [],
    notes: [
      {
        id: noteId as never,
        workspaceId: workspaceId as never,
        folderId: null,
        title: "Dipulihkan",
        content: "Isi",
        pinned: false,
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
}

function snapshotWithBlob(
  workspaceId: string,
  fileId: string,
  blobKey: string,
  kind: BackupSnapshot["kind"],
  data: Uint8Array
): BackupSnapshot {
  return {
    snapshotVersion: 1,
    schemaVersion: 1,
    kind,
    createdAt: AT,
    workspace: {
      id: workspaceId as never,
      name: "Pulih",
      createdAt: AT,
      updatedAt: AT,
    },
    folders: [],
    files: [
      {
        id: fileId as never,
        workspaceId: workspaceId as never,
        folderId: null,
        name: "Pulih.pdf",
        mimeType: "application/pdf",
        sizeBytes: data.byteLength,
        blobKey: blobKey as never,
        checksum: "c".repeat(64),
        createdAt: AT,
        updatedAt: AT,
      },
    ],
    notes: [],
    tags: [],
    fileTags: [],
    noteTags: [],
    noteLinks: [],
    blobs: [
      {
        key: blobKey as never,
        mimeType: "application/pdf",
        data,
      },
    ],
  };
}

export function registerSyncScenarios(create: SyncStorageFactory): void {
  describe("sync", () => {
    it("bootstraps a device and workspace state", async () => {
      await withSync(create, async (storage) => {
        const workspace = await storage.workspaces.ensureWorkspace({ at: AT });
        const devices = await storage.sync.listDevices(workspace.id);

        expect(devices).toHaveLength(1);
        expect(devices[0]?.state).toBe("active");
        const state = await storage.sync.getWorkspaceState(
          workspace.id,
          devices[0]!.deviceId
        );
        expect(state).toMatchObject({
          workspaceId: workspace.id,
          deviceId: devices[0]!.deviceId,
          remoteWorkspaceId: null,
          lastLocalWorkspaceRevision: 1,
        });
      });
    });

    it("records entity and field metadata after create and update", async () => {
      await withSync(create, async (storage) => {
        const workspace = await storage.workspaces.ensureWorkspace({ at: AT });
        const note = await storage.notes.create({
          workspaceId: workspace.id,
          folderId: null,
          title: "Awal",
          content: "Isi",
          at: AT,
        });
        await storage.notes.update(note.id, { title: "Baru", at: AT2 });

        expect(
          await storage.sync.getEntityMeta(workspace.id, "note", note.id)
        ).toMatchObject({ entityRevision: 2, deletedAt: null });
        expect(
          await storage.sync.getFieldMeta(workspace.id, "note", note.id, "title")
        ).toMatchObject({ fieldRevision: 2 });
        expect(
          await storage.sync.getFieldMeta(workspace.id, "note", note.id, "content")
        ).toMatchObject({ fieldRevision: 1 });
      });
    });

    it("shares one workspace revision across a transaction", async () => {
      await withSync(create, async (storage) => {
        const workspace = await storage.workspaces.ensureWorkspace({ at: AT });

        await storage.transaction(async (repos) => {
          const note = await repos.notes.create({
            workspaceId: workspace.id,
            folderId: null,
            title: "Satu",
            content: "",
            at: AT,
          });
          await repos.notes.update(note.id, { title: "Dua", at: AT2 });
        });

        const meta = await storage.sync.listEntityMeta(workspace.id);
        const noteMeta = meta.find((row) => row.entityType === "note");
        expect(noteMeta).toMatchObject({ entityRevision: 2 });
        expect(
          new Set(
            meta
              .filter((row) => row.entityType === "note")
              .map((row) => row.workspaceRevision)
          ).size
        ).toBe(1);
      });
    });

    it("writes no outbox rows with the default policy", async () => {
      await withSync(create, async (storage) => {
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
    });

    it("writes immutable outbox rows with 64-character hashes", async () => {
      await withSync(
        create,
        async (storage) => {
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
          expect(rows[0]).toMatchObject({ state: "pending", attempts: 0 });
          expect(rows[0]?.payloadHash).toMatch(/^[0-9a-f]{64}$/);
        },
        enabled
      );
    });

    it("keeps localSequence unique and monotonic per workspace and device", async () => {
      await withSync(
        create,
        async (storage) => {
          const workspace = await storage.workspaces.ensureWorkspace({ at: AT });

          for (let index = 0; index < 3; index += 1) {
            await storage.notes.create({
              workspaceId: workspace.id,
              folderId: null,
              title: `Catatan ${index}`,
              content: "",
              at: AT,
            });
          }

          const rows = await storage.sync.listOutbox(workspace.id);
          const sequences = rows.map((row) => row.localSequence).sort((a, b) => a - b);
          expect(new Set(sequences).size).toBe(sequences.length);
          expect(sequences).toEqual(
            Array.from({ length: sequences.length }, (_, index) => index + 1)
          );
          expect(new Set(rows.map((row) => row.deviceId)).size).toBe(1);
        },
        enabled
      );
    });

    it("rolls back the entity write when the outbox cap is exceeded", async () => {
      const name = `sync-cap-${suffix()}`;
      const defaultPolicy = await create(name);
      await defaultPolicy.init();
      const workspace = await defaultPolicy.workspaces.ensureWorkspace({ at: AT });
      await defaultPolicy.close();

      const storage = await create(name, {
        outbox: { enabled: true, maxRows: 0, retentionMs: 86_400_000 },
      });
      await storage.init();

      try {
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
      } finally {
        await storage.close();
      }
    });

    it("canonicalizes relation arrays across reordered writes", async () => {
      await withSync(
        create,
        async (storage) => {
          const workspace = await storage.workspaces.ensureWorkspace({ at: AT });
          const note = await storage.notes.create({
            workspaceId: workspace.id,
            folderId: null,
            title: "Relasi",
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
        },
        enabled
      );
    });

    it("tombstones deletes and rejects writes after delete", async () => {
      await withSync(create, async (storage) => {
        const workspace = await storage.workspaces.ensureWorkspace({ at: AT });
        const note = await storage.notes.create({
          workspaceId: workspace.id,
          folderId: null,
          title: "Hapus",
          content: "",
          at: AT,
        });
        await storage.notes.delete(note.id);

        expect(await storage.sync.listTombstones(workspace.id)).toMatchObject([
          { entityId: note.id, state: "active" },
        ]);
        await expect(
          recordSyncChanges(storage.sync, {
            changes: [
              {
                workspaceId: workspace.id,
                entityType: "note",
                entityId: note.id,
                operation: "update",
                fieldPatches: { title: "Ditolak" },
                at: AT2,
                contentHash: null,
              },
            ],
          })
        ).rejects.toMatchObject({ code: "tombstoned_entity" });
      });
    });

    it("lists and resolves conflicts", async () => {
      await withSync(create, async (storage) => {
        const workspace = await storage.workspaces.ensureWorkspace({ at: AT });
        const device = await storage.sync.getOrCreateDevice(workspace.id, AT);
        const conflict: SyncConflictRow = {
          conflictId: "conflict-1",
          workspaceId: workspace.id,
          entityType: "note",
          entityId: "note-1",
          fieldPath: "content",
          localFieldRevision: 1,
          remoteFieldRevision: 1,
          localOpId: "local",
          remoteOpId: "remote",
          localValue: "lokal",
          remoteValue: "remote",
          localDeviceId: device.deviceId,
          remoteDeviceId: "device-remote",
          createdAt: AT,
          state: "open",
          resolution: null,
          resolvedAt: null,
          resolvedByDeviceId: null,
        };
        await storage.sync.putConflict(conflict);

        expect(await storage.sync.listConflicts(workspace.id, "open")).toHaveLength(1);
        await storage.sync.resolveConflict(conflict.conflictId, {
          resolution: "remote",
          resolvedAt: AT2,
          resolvedByDeviceId: device.deviceId,
        });
        expect(await storage.sync.listConflicts(workspace.id, "open")).toEqual([]);
        expect(await storage.sync.listConflicts(workspace.id, "resolved")).toMatchObject([
          { conflictId: "conflict-1", resolution: "remote" },
        ]);
      });
    });

    it("clears sidecars on reset", async () => {
      await withSync(create, async (storage) => {
        const workspace = await storage.workspaces.ensureWorkspace({ at: AT });
        const note = await storage.notes.create({
          workspaceId: workspace.id,
          folderId: null,
          title: "Hapus",
          content: "",
          at: AT,
        });
        await storage.notes.delete(note.id);
        await storage.reset();

        expect(await storage.sync.listEntityMeta(workspace.id)).toEqual([]);
        expect(await storage.sync.listFieldMeta(workspace.id)).toEqual([]);
        expect(await storage.sync.listTombstones(workspace.id)).toEqual([]);
        expect(await storage.sync.listDevices(workspace.id)).toEqual([]);
        expect(await storage.sync.listOutbox(workspace.id)).toEqual([]);
        expect(await storage.sync.listConflicts(workspace.id)).toEqual([]);
        expect(
          await storage.sync.getWorkspaceState(workspace.id, "missing-device")
        ).toBeNull();
      });
    });

    it("restore clears stale sidecars and backfills entities", async () => {
      await withSync(create, async (storage) => {
        const workspace = await storage.workspaces.ensureWorkspace({ at: AT });
        const note = await storage.notes.create({
          workspaceId: workspace.id,
          folderId: null,
          title: "Lama",
          content: "",
          at: AT,
        });
        await storage.notes.delete(note.id);

        const workspaceId = "77777777-7777-4777-8777-777777777777";
        const noteId = "88888888-8888-4888-8888-888888888888";
        await storage.restore(snapshot(workspaceId, noteId, storage.kind));

        expect(await storage.sync.listTombstones(workspaceId)).toEqual([]);
        expect(await storage.sync.listEntityMeta(workspaceId)).toHaveLength(2);
        expect(
          await storage.sync.getFieldMeta(workspaceId, "note", noteId, "title")
        ).toMatchObject({ fieldRevision: 1 });
        expect(await storage.sync.listDevices(workspaceId)).toHaveLength(1);
      });
    });

    it("accepts backup v1 and creates fresh sidecars", async () => {
      await withSync(create, async (storage) => {
        const workspaceId = "99999999-9999-4999-8999-999999999999";
        const noteId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
        await storage.restore(snapshot(workspaceId, noteId, storage.kind));

        expect((await storage.workspaces.get(workspaceId as never))?.name).toBe("Pulih");
        expect((await storage.notes.get(noteId as never))?.title).toBe("Dipulihkan");
        expect(await storage.sync.listEntityMeta(workspaceId)).toHaveLength(2);
      });
    });

    it("guards restore while a remote target exists", async () => {
      await withSync(create, async (storage) => {
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
          storage.restore(
            snapshot(
              "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
              "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
              storage.kind
            )
          )
        ).rejects.toMatchObject({ code: "remote_target_present" });

        expect(await storage.workspaces.get(workspace.id)).not.toBeNull();
        expect(await storage.notes.get(note.id)).not.toBeNull();
        expect(
          await storage.sync.getWorkspaceState(workspace.id, device.deviceId)
        ).toMatchObject({ remoteWorkspaceId: "remote-1" });
      });
    });

    it("tracks workspace revisions independently in one transaction", async () => {
      await withSync(create, async (storage) => {
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
    });

    it("keeps the high-water mark after an outbox row is deleted", async () => {
      await withSync(
        create,
        async (storage) => {
          const workspace = await storage.workspaces.ensureWorkspace({ at: AT });
          const device = await storage.sync.getOrCreateDevice(workspace.id, AT);
          await storage.notes.create({
            workspaceId: workspace.id,
            folderId: null,
            title: "Catatan",
            content: "",
            at: AT,
          });

          const rows = await storage.sync.listOutbox(workspace.id);
          const highest = Math.max(...rows.map((row) => row.localSequence));
          const row = rows.find((entry) => entry.localSequence === highest);
          await storage.sync.deleteOutbox(row!.opId);

          expect(
            await storage.sync.nextLocalSequence(workspace.id, device.deviceId)
          ).toBe(highest + 1);
        },
        enabled
      );
    });

    it("rejects a duplicate outbox opId without changing the original row", async () => {
      await withSync(
        create,
        async (storage) => {
          const workspace = await storage.workspaces.ensureWorkspace({ at: AT });
          const note = await storage.notes.create({
            workspaceId: workspace.id,
            folderId: null,
            title: "Tetap",
            content: "",
            at: AT,
          });
          const [row] = (await storage.sync.listOutbox(workspace.id)).filter(
            (entry) => entry.entityId === note.id
          );

          await expect(
            storage.sync.appendOutbox({
              ...row!,
              localSequence: row!.localSequence + 1,
            })
          ).rejects.toMatchObject({ code: "invalid_sync_state" });

          expect(
            (await storage.sync.listOutbox(workspace.id)).filter(
              (entry) => entry.opId === row!.opId
            )
          ).toMatchObject([{ localSequence: row!.localSequence }]);
        },
        enabled
      );
    });

    it("preserves the local sequence high-water across restore", async () => {
      await withSync(create, async (storage) => {
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

        await storage.restore(
          snapshot(workspace.id, "dddddddd-dddd-4ddd-8ddd-dddddddddddd", storage.kind)
        );

        const [restoredDevice] = await storage.sync.listDevices(workspace.id);
        expect(restoredDevice?.deviceId).toBe(device.deviceId);
        expect(
          await storage.sync.getWorkspaceState(workspace.id, device.deviceId)
        ).toMatchObject({ lastLocalSequence: 4 });
        expect(await storage.sync.nextLocalSequence(workspace.id, device.deviceId)).toBe(
          5
        );
      });
    });

    it("does not overwrite blobs when restore is blocked", async () => {
      await withSync(create, async (storage) => {
        const workspace = await storage.workspaces.ensureWorkspace({ at: AT });
        const blobKey = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
        await storage.files.create({
          workspaceId: workspace.id,
          folderId: null,
          name: "Lama.pdf",
          mimeType: "application/pdf",
          sizeBytes: 2,
          blobKey: blobKey as never,
          checksum: "checksum-1",
          at: AT,
        });
        await storage.blobs.put(blobKey as never, new Uint8Array([1, 2]));
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
          storage.restore(
            snapshotWithBlob(
              "ffffffff-ffff-4fff-8fff-ffffffffffff",
              "11111111-1111-4111-8111-111111111111",
              blobKey,
              storage.kind,
              new Uint8Array([9, 9, 9])
            )
          )
        ).rejects.toMatchObject({ code: "remote_target_present" });

        const blob = await storage.blobs.get(blobKey as never);
        expect(blob).not.toBeNull();
        expect(Array.from(new Uint8Array(await blob!.arrayBuffer()))).toEqual([1, 2]);
      });
    });

    it("matches the revision and metadata contract shapes", async () => {
      await withSync(create, async (storage) => {
        const workspace = await storage.workspaces.ensureWorkspace({ at: AT });
        const note = await storage.notes.create({
          workspaceId: workspace.id,
          folderId: null,
          title: "Bentuk",
          content: "Isi",
          at: AT,
        });
        const devices = await storage.sync.listDevices(workspace.id);
        const meta = await storage.sync.getEntityMeta(workspace.id, "note", note.id);

        expect(meta).toEqual({
          workspaceId: workspace.id,
          entityType: "note",
          entityId: note.id,
          entityRevision: 1,
          workspaceRevision: 2,
          originDeviceId: devices[0]!.deviceId,
          updatedAt: AT,
          deletedAt: null,
          contentHash: null,
        });
        const field = await storage.sync.getFieldMeta(
          workspace.id,
          "note",
          note.id,
          "title"
        );
        expect(field).toEqual({
          workspaceId: workspace.id,
          entityType: "note",
          entityId: note.id,
          fieldPath: "title",
          fieldRevision: 1,
          workspaceRevision: 2,
          originDeviceId: devices[0]!.deviceId,
          updatedAt: AT,
          deletedAt: null,
        });
      });
    });
  });
}
