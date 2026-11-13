import { describe, expect, it } from "vitest";

import {
  DomainError,
  type BackupSnapshot,
  type BlobKey,
  type FileId,
  type FolderId,
  type IsoDate,
  type NoteId,
  type TagId,
  type WorkspaceId,
} from "@opennest/core";

import { withHarness } from "../harness";
import type { StorageFactory } from "../index";

const AT = "2026-11-12T00:00:00.000Z" as IsoDate;

const SNAPSHOT: BackupSnapshot = {
  snapshotVersion: 1,
  schemaVersion: 1,
  kind: "dexie",
  createdAt: AT,
  workspace: {
    id: "11111111-1111-4111-8111-111111111111" as WorkspaceId,
    name: "Rumah",
    createdAt: AT,
    updatedAt: AT,
  },
  folders: [
    {
      id: "22222222-2222-4222-8222-222222222222" as FolderId,
      workspaceId: "11111111-1111-4111-8111-111111111111" as WorkspaceId,
      parentId: null,
      name: "Berkas",
      createdAt: AT,
      updatedAt: AT,
    },
  ],
  files: [
    {
      id: "33333333-3333-4333-8333-333333333333" as FileId,
      workspaceId: "11111111-1111-4111-8111-111111111111" as WorkspaceId,
      folderId: "22222222-2222-4222-8222-222222222222" as FolderId,
      name: "laporan.pdf",
      mimeType: "application/pdf",
      sizeBytes: 2,
      blobKey: "44444444-4444-4444-8444-444444444444" as BlobKey,
      checksum: null,
      createdAt: AT,
      updatedAt: AT,
    },
  ],
  notes: [
    {
      id: "55555555-5555-4555-8555-555555555555" as NoteId,
      workspaceId: "11111111-1111-4111-8111-111111111111" as WorkspaceId,
      folderId: "22222222-2222-4222-8222-222222222222" as FolderId,
      title: "Catatan",
      content: "isi",
      pinned: true,
      createdAt: AT,
      updatedAt: AT,
    },
  ],
  tags: [
    {
      id: "66666666-6666-4666-8666-666666666666" as TagId,
      workspaceId: "11111111-1111-4111-8111-111111111111" as WorkspaceId,
      name: "Kerja",
      color: null,
      createdAt: AT,
    },
  ],
  fileTags: [
    {
      fileId: "33333333-3333-4333-8333-333333333333" as FileId,
      tagId: "66666666-6666-4666-8666-666666666666" as TagId,
    },
  ],
  noteTags: [
    {
      noteId: "55555555-5555-4555-8555-555555555555" as NoteId,
      tagId: "66666666-6666-4666-8666-666666666666" as TagId,
    },
  ],
  noteLinks: [],
  blobs: [
    {
      key: "44444444-4444-4444-8444-444444444444" as BlobKey,
      mimeType: "application/pdf",
      data: new Uint8Array([8, 9]),
    },
  ],
};

function cloneSnapshot(): BackupSnapshot {
  return structuredClone(SNAPSHOT);
}

export function registerRestoreScenarios(create: StorageFactory): void {
  describe("restore", () => {
    it("replaces the dataset with the snapshot", async () => {
      await withHarness(create, async ({ storage, services, workspace }) => {
        await services.note.create({
          workspaceId: workspace.id,
          folderId: null,
          title: "Lama",
        });

        await storage.restore(cloneSnapshot());

        expect((await storage.workspaces.list()).map((row) => row.name)).toEqual([
          "Rumah",
        ]);
        expect((await storage.notes.list(SNAPSHOT.workspace.id, {})).total).toBe(1);
        expect(
          (await storage.notes.list(SNAPSHOT.workspace.id, {})).items[0]?.title
        ).toBe("Catatan");
        expect((await storage.folders.list(SNAPSHOT.workspace.id, {})).total).toBe(1);
        expect((await storage.files.list(SNAPSHOT.workspace.id, {})).total).toBe(1);
        expect((await storage.tags.list(SNAPSHOT.workspace.id, {})).total).toBe(1);
        expect(
          (
            await storage.notes.tags("55555555-5555-4555-8555-555555555555" as NoteId)
          ).map((row) => row.name)
        ).toEqual(["Kerja"]);
        expect(await storage.blobs.has(SNAPSHOT.files[0]!.blobKey)).toBe(true);
        expect(
          Array.from(
            new Uint8Array(
              await (await storage.blobs.get(SNAPSHOT.files[0]!.blobKey))!.arrayBuffer()
            )
          )
        ).toEqual([8, 9]);
      });
    });

    it("rejects a snapshot with a dangling folder reference and keeps the old dataset", async () => {
      await withHarness(create, async ({ storage, services, workspace }) => {
        await services.note.create({
          workspaceId: workspace.id,
          folderId: null,
          title: "Tetap ada",
        });

        const broken = cloneSnapshot();
        broken.files[0] = {
          ...broken.files[0]!,
          folderId: "99999999-9999-4999-8999-999999999999" as FolderId,
        };

        await expect(storage.restore(broken)).rejects.toBeInstanceOf(DomainError);
        expect((await storage.notes.list(workspace.id, {})).items[0]?.title).toBe(
          "Tetap ada"
        );
        expect((await storage.workspaces.list()).map((row) => row.name)).toEqual([
          workspace.name,
        ]);
      });
    });

    it("rejects a snapshot with a dangling tag reference", async () => {
      await withHarness(create, async ({ storage }) => {
        const broken = cloneSnapshot();
        broken.fileTags[0] = {
          fileId: "33333333-3333-4333-8333-333333333333" as FileId,
          tagId: "99999999-9999-4999-8999-999999999999" as TagId,
        };

        await expect(storage.restore(broken)).rejects.toBeInstanceOf(DomainError);
      });
    });

    it("rejects an unsupported snapshot version", async () => {
      await withHarness(create, async ({ storage }) => {
        const broken = cloneSnapshot();
        broken.snapshotVersion = 2 as never;

        await expect(storage.restore(broken)).rejects.toBeInstanceOf(DomainError);
      });
    });
  });
}
