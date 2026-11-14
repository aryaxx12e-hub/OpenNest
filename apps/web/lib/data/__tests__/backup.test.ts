import { describe, expect, it } from "vitest";

import { createMemoryStorage, type BlobKey, type IsoDate } from "@opennest/core";

import {
  BackupError,
  backupErrorKey,
  backupFileName,
  buildBackup,
  parseBackupFile,
  summarizeBackup,
} from "../backup";
import { createAppServices, randomBlobKey, sha256Hex } from "../services";

const AT = "2026-11-13T12:34:56.000Z" as IsoDate;

async function seed() {
  const storage = createMemoryStorage();
  const { services, workspace } = await createAppServices(storage, {
    defaultWorkspaceName: "My Library",
    clock: () => AT,
    hash: sha256Hex,
    generateBlobKey: () => "44444444-4444-4444-8444-444444444444",
  });

  const folder = await services.folder.create({
    workspaceId: workspace.id,
    parentId: null,
    name: "Projects",
  });
  const file = await services.file.upload({
    workspaceId: workspace.id,
    folderId: folder.id,
    name: "hello.txt",
    mimeType: "text/plain",
    data: new TextEncoder().encode("hello"),
  });
  const firstNote = await services.note.create({
    workspaceId: workspace.id,
    folderId: folder.id,
    title: "First",
    content: "# Hello",
  });
  const secondNote = await services.note.create({
    workspaceId: workspace.id,
    folderId: null,
    title: "Second",
  });
  const tag = await services.tag.create({
    workspaceId: workspace.id,
    name: "Important",
    color: "#AABBCC",
  });

  await services.file.setTags(file.id, [tag.id]);
  await services.note.setTags(firstNote.id, [tag.id]);
  await services.note.setLinks(firstNote.id, [secondNote.id]);

  return { storage, services, workspace, folder, file, firstNote, secondNote, tag };
}

function envelope(text: string): Record<string, unknown> {
  return JSON.parse(text) as Record<string, unknown>;
}

describe("buildBackup", () => {
  it("exports every entity, relationship, and blob", async () => {
    const { storage, workspace, folder, file, firstNote, secondNote, tag } = await seed();
    const built = await buildBackup(storage, workspace.id, { now: () => AT });

    expect(built.fileName).toBe("opennest-backup-2026-11-13.json");
    expect(built.snapshot.snapshotVersion).toBe(1);
    expect(built.snapshot.kind).toBe("dexie");
    expect(built.snapshot.workspace.id).toBe(workspace.id);
    expect(built.snapshot.folders.map((row) => row.id)).toEqual([folder.id]);
    expect(built.snapshot.files.map((row) => row.id)).toEqual([file.id]);
    expect(built.snapshot.notes.map((row) => row.id).sort()).toEqual(
      [firstNote.id, secondNote.id].sort()
    );
    expect(built.snapshot.tags.map((row) => row.id)).toEqual([tag.id]);
    expect(built.snapshot.fileTags).toEqual([{ fileId: file.id, tagId: tag.id }]);
    expect(built.snapshot.noteTags).toEqual([{ noteId: firstNote.id, tagId: tag.id }]);
    expect(built.snapshot.noteLinks).toEqual([
      { sourceNoteId: firstNote.id, targetNoteId: secondNote.id },
    ]);
    expect(Array.from(built.snapshot.blobs[0]!.data)).toEqual(
      Array.from(new TextEncoder().encode("hello"))
    );
    expect(built.summary).toEqual({ files: 1, notes: 2, folders: 1, tags: 1 });
    expect(built.text).toContain('"format": "opennest-backup"');
    expect(built.text).toContain('"data": "aGVsbG8="');
  });

  it("fails instead of exporting a file whose blob is missing", async () => {
    const storage = createMemoryStorage();
    const { workspace } = await createAppServices(storage, {
      defaultWorkspaceName: "My Library",
      clock: () => AT,
      hash: sha256Hex,
      generateBlobKey: randomBlobKey,
    });

    await storage.files.create({
      workspaceId: workspace.id,
      folderId: null,
      name: "missing.txt",
      mimeType: "text/plain",
      sizeBytes: 5,
      blobKey: "44444444-4444-4444-8444-444444444444" as BlobKey,
      checksum: "a".repeat(64),
      at: AT,
    });

    await expect(buildBackup(storage, workspace.id)).rejects.toMatchObject({
      code: "missingBlob",
    });
  });
});

describe("parseBackupFile", () => {
  it("round-trips an exported backup", async () => {
    const { storage, workspace } = await seed();
    const built = await buildBackup(storage, workspace.id, { now: () => AT });
    const parsed = await parseBackupFile(built.text);

    expect(parsed.workspace.id).toBe(workspace.id);
    expect(parsed.files).toHaveLength(1);
    expect(parsed.notes).toHaveLength(2);
    expect(Array.from(parsed.blobs[0]!.data)).toEqual(
      Array.from(new TextEncoder().encode("hello"))
    );

    const restored = createMemoryStorage();
    await restored.restore(parsed);

    expect((await restored.notes.list(workspace.id, {})).total).toBe(2);
    expect(await restored.blobs.has(parsed.files[0]!.blobKey)).toBe(true);
    expect((await restored.files.tags(parsed.files[0]!.id)).map((tag) => tag.id)).toEqual(
      [parsed.tags[0]!.id]
    );
    expect(
      (
        await restored.notes.tags(parsed.notes.find((row) => row.title === "First")!.id)
      ).map((tag) => tag.id)
    ).toEqual([parsed.tags[0]!.id]);
    expect(
      await restored.notes.links(parsed.notes.find((row) => row.title === "First")!.id)
    ).toEqual([
      {
        sourceNoteId: parsed.notes.find((row) => row.title === "First")!.id,
        targetNoteId: parsed.notes.find((row) => row.title === "Second")!.id,
      },
    ]);
  });

  it("rejects invalid JSON", async () => {
    await expect(parseBackupFile("{not json")).rejects.toMatchObject({
      code: "invalidJson",
    });
  });

  it("rejects a different format marker", async () => {
    const { storage, workspace } = await seed();
    const built = await buildBackup(storage, workspace.id, { now: () => AT });
    const value = envelope(built.text);
    value.format = "opennest-archive";

    await expect(parseBackupFile(JSON.stringify(value))).rejects.toMatchObject({
      code: "invalidFormat",
    });
  });

  it("rejects an unsupported format version", async () => {
    const { storage, workspace } = await seed();
    const built = await buildBackup(storage, workspace.id, { now: () => AT });
    const value = envelope(built.text);
    value.formatVersion = 2;

    await expect(parseBackupFile(JSON.stringify(value))).rejects.toMatchObject({
      code: "unsupportedVersion",
    });
  });

  it("rejects an invalid base64 blob", async () => {
    const { storage, workspace } = await seed();
    const built = await buildBackup(storage, workspace.id, { now: () => AT });
    const value = envelope(built.text);
    const snapshot = value.snapshot as { blobs: { data: string }[] };
    snapshot.blobs[0]!.data = "!!!!";

    await expect(parseBackupFile(JSON.stringify(value))).rejects.toMatchObject({
      code: "invalidBlob",
    });
  });

  it("rejects inconsistent references before restoring", async () => {
    const { storage, workspace } = await seed();
    const built = await buildBackup(storage, workspace.id, { now: () => AT });
    const value = envelope(built.text);
    const snapshot = value.snapshot as { files: { folderId: string }[] };
    snapshot.files[0]!.folderId = "99999999-9999-4999-8999-999999999999";

    await expect(parseBackupFile(JSON.stringify(value))).rejects.toMatchObject({
      code: "invalidSnapshot",
    });
  });

  it("rejects a file whose blob is missing", async () => {
    const { storage, workspace } = await seed();
    const built = await buildBackup(storage, workspace.id, { now: () => AT });
    const value = envelope(built.text);
    const snapshot = value.snapshot as { blobs: unknown[] };
    snapshot.blobs = [];

    await expect(parseBackupFile(JSON.stringify(value))).rejects.toMatchObject({
      code: "invalidSnapshot",
    });
  });

  it("rejects a blob whose checksum does not match", async () => {
    const { storage, workspace } = await seed();
    const built = await buildBackup(storage, workspace.id, { now: () => AT });
    const value = envelope(built.text);
    const snapshot = value.snapshot as { files: { checksum: string }[] };
    snapshot.files[0]!.checksum = "b".repeat(64);

    await expect(parseBackupFile(JSON.stringify(value))).rejects.toMatchObject({
      code: "checksumMismatch",
    });
  });
});

describe("backup helpers", () => {
  it("builds a date-based file name", () => {
    expect(backupFileName(AT)).toBe("opennest-backup-2026-11-13.json");
  });

  it("summarizes a snapshot", async () => {
    const { storage, workspace } = await seed();
    const built = await buildBackup(storage, workspace.id, { now: () => AT });

    expect(summarizeBackup(built.snapshot)).toEqual({
      files: 1,
      notes: 2,
      folders: 1,
      tags: 1,
    });
  });

  it("maps backup errors to localized keys", () => {
    expect(backupErrorKey(new BackupError("invalidJson", "bad"))).toBe(
      "backup.errors.invalidJson"
    );
    expect(backupErrorKey(new Error("boom"))).toBe("errors.unexpected");
  });
});
