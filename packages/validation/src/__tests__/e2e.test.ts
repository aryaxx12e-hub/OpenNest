import { describe, expect, it } from "vitest";

import {
  createMemoryStorage,
  fileFixture,
  folderFixture,
  tagFixture,
  workspaceFixture,
  type BackupSnapshot,
  type IsoDate,
  type BlobKey,
} from "@opennest/core";

import { backupSnapshotSchema, fileInputSchema, folderInputSchema } from "../index";

const AT = "2026-11-12T00:00:00.000Z" as IsoDate;
const PDF = "application/pdf";

describe("snapshot validation against the reference adapter", () => {
  it("accepts a snapshot built from real fixtures and restores it", async () => {
    const storage = createMemoryStorage();
    await storage.init();

    const workspace = workspaceFixture();
    const folder = folderFixture({ workspaceId: workspace.id });
    const tag = tagFixture({ workspaceId: workspace.id, color: "#aabbcc" });
    const data = new Uint8Array([1, 2, 3]);
    const file = fileFixture({
      workspaceId: workspace.id,
      folderId: folder.id,
      sizeBytes: data.byteLength,
      mimeType: PDF,
      checksum: "a".repeat(64),
    });

    const snapshot: BackupSnapshot = {
      snapshotVersion: 1,
      schemaVersion: storage.schemaVersion,
      kind: storage.kind,
      createdAt: AT,
      workspace,
      folders: [folder],
      files: [file],
      notes: [],
      tags: [tag],
      fileTags: [{ fileId: file.id, tagId: tag.id }],
      noteTags: [],
      noteLinks: [],
      blobs: [{ key: file.blobKey, mimeType: PDF, data }],
    };

    expect(backupSnapshotSchema.safeParse(snapshot).success).toBe(true);

    await storage.restore(snapshot);

    expect(await storage.workspaces.get(workspace.id)).toEqual(workspace);
    expect(await storage.files.get(file.id)).toEqual(file);
    expect(await storage.blobs.get(file.blobKey)).not.toBeNull();

    await storage.close();
  });

  it("rejects the same snapshot once a reference dangles", async () => {
    const storage = createMemoryStorage();
    await storage.init();

    const workspace = workspaceFixture();
    const folder = folderFixture({ workspaceId: workspace.id });
    const data = new Uint8Array([1]);
    const file = fileFixture({
      workspaceId: workspace.id,
      folderId: folder.id,
      sizeBytes: 1,
      blobKey: "3f2b8c1e-9d4a-4f6b-8c2d-1a2b3c4d5e6f" as BlobKey,
    });

    const snapshot: BackupSnapshot = {
      snapshotVersion: 1,
      schemaVersion: storage.schemaVersion,
      kind: storage.kind,
      createdAt: AT,
      workspace,
      folders: [folder],
      files: [file],
      notes: [],
      tags: [],
      fileTags: [],
      noteTags: [],
      noteLinks: [],
      blobs: [{ key: file.blobKey, mimeType: PDF, data }],
    };

    expect(backupSnapshotSchema.safeParse(snapshot).success).toBe(true);

    const dangling: BackupSnapshot = { ...snapshot, folders: [] };

    expect(backupSnapshotSchema.safeParse(dangling).success).toBe(false);

    await storage.close();
  });
});

describe("parsed input flows into the adapter", () => {
  it("creates a folder and a file from schema output", async () => {
    const storage = createMemoryStorage();
    await storage.init();

    const workspace = await storage.workspaces.ensureWorkspace({ at: AT });
    const folder = folderInputSchema.parse({
      workspaceId: workspace.id,
      parentId: null,
      name: "  Kerja  ",
    });

    const created = await storage.folders.create({
      workspaceId: folder.workspaceId,
      parentId: folder.parentId,
      name: folder.name,
      at: AT,
    });

    expect(created.name).toBe("Kerja");

    const file = fileInputSchema.parse({
      workspaceId: workspace.id,
      folderId: created.id,
      name: "laporan.pdf",
      mimeType: PDF,
      sizeBytes: 0,
      blobKey: "3f2b8c1e-9d4a-4f6b-8c2d-1a2b3c4d5e6f",
      checksum: null,
    });

    const row = await storage.files.create({
      workspaceId: file.workspaceId,
      folderId: file.folderId,
      name: file.name,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      blobKey: file.blobKey,
      checksum: file.checksum,
      at: AT,
    });

    expect(row.folderId).toBe(created.id);
    expect(row.checksum).toBeNull();

    await storage.close();
  });
});
