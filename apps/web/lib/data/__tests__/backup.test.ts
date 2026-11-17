import { describe, expect, it } from "vitest";

import {
  createMemoryStorage,
  type BlobKey,
  type IsoDate,
  type WorkspaceId,
} from "@opennest/core";

import {
  BackupError,
  backupErrorKey,
  backupFileName,
  buildBackup,
  buildBackupV2,
  createBackupKey,
  inspectBackupFile,
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
    expect(built.formatVersion).toBe(1);
    expect(built.encrypted).toBe(false);
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

  it("rejects duplicate keys in the outer backup JSON", async () => {
    const { storage, workspace } = await seed();
    const built = await buildBackup(storage, workspace.id, { now: () => AT });
    const duplicated = built.text.replace(
      '"format": "opennest-backup"',
      '"format": "opennest-backup", "format": "opennest-backup"'
    );

    await expect(parseBackupFile(duplicated)).rejects.toMatchObject({
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
    value.formatVersion = 3;

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

describe("backup format v2", () => {
  const passphrase = { kind: "passphrase" as const, passphrase: "correct horse" };
  const TARGET = "77777777-7777-4777-8777-777777777777" as WorkspaceId;

  async function builtV2(options: { backupKey?: string; chunkSize?: number } = {}) {
    const fixture = await seed();
    const v1 = await buildBackup(fixture.storage, fixture.workspace.id, {
      now: () => AT,
    });
    const keySource =
      options.backupKey === undefined
        ? passphrase
        : { kind: "backupKey" as const, backupKey: options.backupKey };
    const built = await buildBackupV2(v1.snapshot, keySource, {
      now: () => AT,
      chunkSize: options.chunkSize,
      kid: "backup-key-id",
    });

    return { ...fixture, v1, built };
  }

  it("inspects v1 and v2 headers without decrypting v2", async () => {
    const { storage, workspace } = await seed();
    const v1 = await buildBackup(storage, workspace.id, { now: () => AT });
    const v2 = await buildBackupV2(v1.snapshot, passphrase, {
      now: () => AT,
    });

    expect(inspectBackupFile(v1.text)).toEqual({
      formatVersion: 1,
      exportedAt: AT,
      encrypted: false,
    });
    expect(inspectBackupFile(v2.text)).toMatchObject({
      formatVersion: 2,
      exportedAt: AT,
      encrypted: true,
      chunkCount: 1,
      chunkSize: 4 * 1024 * 1024,
      summary: {
        counts: { workspaces: 1, folders: 1, tags: 1, files: 1, notes: 2 },
      },
    });
  });

  it("round-trips an encrypted backup with a passphrase", async () => {
    const { built } = await builtV2();
    const parsed = await parseBackupFile(built.text, passphrase);

    expect(parsed.workspace.id).toBe(built.snapshot.workspace.id);
    expect(parsed.notes.map((note) => note.title).sort()).toEqual(["First", "Second"]);
    expect(parsed.files).toHaveLength(1);
    expect(Array.from(parsed.blobs[0]!.data)).toEqual(
      Array.from(new TextEncoder().encode("hello"))
    );
  });

  it("round-trips an encrypted backup with a generated backup key", async () => {
    const generated = createBackupKey();
    const { built } = await builtV2({ backupKey: generated });
    const parsed = await parseBackupFile(built.text, {
      kind: "backupKey",
      backupKey: generated,
    });

    expect(parsed.notes).toHaveLength(2);
    expect(generated.startsWith("ONBK1-")).toBe(true);
  });

  it("does not serialize titles, content, blobs, workspace IDs, or key material", async () => {
    const { built, workspace } = await builtV2();

    expect(built.text).not.toContain(workspace.id);
    expect(built.text).not.toContain("First");
    expect(built.text).not.toContain("# Hello");
    expect(built.text).not.toContain("aGVsbG8=");
    expect(built.text).not.toContain("ONRK1-");
    expect(built.text).not.toContain("ONBK1-");
    expect(built.text).not.toContain("recoveryKey");
    expect(built.text).not.toContain("keyring");
    expect(built.text).toContain('"formatVersion": 2');
    expect(built.text).toContain('"ciphertext"');
  });

  it("rejects an unreadable v2 backup unless a key source is provided", async () => {
    const { built } = await builtV2();

    await expect(parseBackupFile(built.text)).rejects.toMatchObject({
      code: "missingKey",
    });
  });

  it("rejects a wrong key and tampered chunks or headers", async () => {
    const { built } = await builtV2();
    const wrong = { kind: "passphrase" as const, passphrase: "incorrect horse" };
    const payloadTamper = envelope(built.text);
    const chunks = payloadTamper.chunks as Array<{
      ciphertext: string;
      tag: string;
    }>;
    chunks[0]!.ciphertext = `${chunks[0]!.ciphertext.slice(0, -2)}AA`;

    const headerTamper = envelope(built.text);
    const encryption = headerTamper.encryption as { kid: string };
    encryption.kid = "another-key-id";

    await expect(parseBackupFile(built.text, wrong)).rejects.toMatchObject({
      code: "wrongKey",
    });
    await expect(
      parseBackupFile(JSON.stringify(payloadTamper), passphrase)
    ).rejects.toMatchObject({ code: "wrongKey" });
    await expect(
      parseBackupFile(JSON.stringify(headerTamper), passphrase)
    ).rejects.toMatchObject({ code: "wrongKey" });
  });

  it("rejects truncated tags, reordered chunks, and a tampered summary", async () => {
    const { built } = await builtV2({ chunkSize: 8 });
    const truncated = envelope(built.text);
    const truncatedChunks = truncated.chunks as Array<{ tag: string }>;
    truncatedChunks[0]!.tag = truncatedChunks[0]!.tag.slice(0, 8);

    const reordered = envelope(built.text);
    const reorderedChunks = reordered.chunks as Array<Record<string, unknown>>;
    [reorderedChunks[0], reorderedChunks[1]] = [reorderedChunks[1]!, reorderedChunks[0]!];

    const summary = envelope(built.text);
    const summaryBlock = summary.summary as { counts: { notes: number } };
    summaryBlock.counts.notes += 1;

    await expect(
      parseBackupFile(JSON.stringify(truncated), passphrase)
    ).rejects.toMatchObject({ code: "invalidEncryption" });
    await expect(
      parseBackupFile(JSON.stringify(reordered), passphrase)
    ).rejects.toMatchObject({ code: "invalidEncryption" });
    await expect(
      parseBackupFile(JSON.stringify(summary), passphrase)
    ).rejects.toMatchObject({ code: "invalidSummary" });
  });

  it("maps a v2 snapshot to the current workspace without changing entity IDs", async () => {
    const { built, folder, file, firstNote, tag } = await builtV2();
    const parsed = await parseBackupFile(built.text, passphrase, {
      targetWorkspaceId: TARGET,
    });

    expect(parsed.workspace.id).toBe(TARGET);
    expect(parsed.workspace.name).toBe(built.snapshot.workspace.name);
    expect(parsed.folders.map((row) => row.id)).toEqual([folder.id]);
    expect(parsed.files.map((row) => row.id)).toEqual([file.id]);
    expect(parsed.notes.map((row) => row.id).sort()).toEqual(
      [
        firstNote.id,
        ...parsed.notes.filter((note) => note.id !== firstNote.id).map((note) => note.id),
      ].sort()
    );
    expect(parsed.tags.map((row) => row.id)).toEqual([tag.id]);
    expect(parsed.folders[0]!.workspaceId).toBe(TARGET);
    expect(parsed.files[0]!.workspaceId).toBe(TARGET);
    expect(parsed.notes.every((row) => row.workspaceId === TARGET)).toBe(true);
    expect(parsed.tags[0]!.workspaceId).toBe(TARGET);
  });

  it("fails a checksum mismatch before restore", async () => {
    const { v1 } = await builtV2();
    const snapshot = {
      ...v1.snapshot,
      files: v1.snapshot.files.map((file) => ({
        ...file,
        checksum: "b".repeat(64),
      })),
    };
    const built = await buildBackupV2(snapshot, passphrase, { now: () => AT });

    await expect(parseBackupFile(built.text, passphrase)).rejects.toMatchObject({
      code: "checksumMismatch",
    });
  });

  it("writes plaintext checksums even when the adapter reports ciphertext checksums", async () => {
    const fixture = await seed();
    const files = {
      ...fixture.storage.files,
      async list(...args: Parameters<typeof fixture.storage.files.list>) {
        const page = await fixture.storage.files.list(...args);

        return {
          ...page,
          items: page.items.map((file) => ({
            ...file,
            checksum: "b".repeat(64),
          })),
        };
      },
    };
    const built = await buildBackup({ ...fixture.storage, files }, fixture.workspace.id, {
      now: () => AT,
    });

    expect(built.snapshot.files[0]!.checksum).toBe(
      await sha256Hex(new TextEncoder().encode("hello"))
    );
    await expect(buildBackupV2(built.snapshot, passphrase)).resolves.toBeTruthy();
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
