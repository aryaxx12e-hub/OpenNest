import {
  type BackupSnapshot,
  type BlobKey,
  type FileTag,
  type IsoDate,
  type ListOptions,
  type Note,
  type NoteLink,
  type NoteTag,
  type Page,
  type StorageAdapter,
  type WorkspaceId,
  generateId,
} from "@opennest/core";

import { bytesToHex } from "./bytes";
import {
  openBytes,
  openText,
  parseBinaryEnvelope,
  parseTextEnvelope,
  sealBytes,
  sealText,
  type WorkspaceCryptoContext,
} from "./envelope";
import { CryptoError } from "./errors";
import type { EncryptionState, Keyring, KeyringRecordV1 } from "./keyring";
import { getWebCrypto } from "./random";

const PAGE_SIZE = 500;
const TEXT_PREFIX = "enc1:";
const BINARY_MAGIC = [0x4f, 0x4e, 0x42, 0x31];

export interface MigrationDraftRecord {
  workspaceId: string;
  noteId: string;
}

export interface MigrationDraftStore<T extends MigrationDraftRecord> {
  list(): Promise<T[]>;
  get(workspaceId: string, noteId: string): Promise<T | null>;
  put(draft: T): Promise<void>;
  remove(workspaceId: string, noteId: string): Promise<void>;
}

export interface MigrationDrafts<T extends MigrationDraftRecord> {
  plaintext: MigrationDraftStore<T>;
  encrypted: MigrationDraftStore<T>;
}

export type MigrationPhase =
  "start" | "drafts" | "snapshot" | "verify" | "restore" | "cleanup" | "active";

export interface MigrationProgress {
  state: EncryptionState;
  phase: MigrationPhase;
  completed: number;
  total: number;
}

export interface MigrationOptions<T extends MigrationDraftRecord> {
  base: StorageAdapter;
  keyring: Keyring;
  drafts?: MigrationDrafts<T>;
  onProgress?: (progress: MigrationProgress) => void;
}

export interface EnableEncryptionOptions<
  T extends MigrationDraftRecord,
> extends MigrationOptions<T> {
  passphrase: string;
  recoveryKey?: string;
  onRecoveryKey?: (recoveryKey: string) => void;
}

export interface EnableEncryptionResult {
  record: KeyringRecordV1;
  context: WorkspaceCryptoContext;
  recoveryKey: string;
}

export interface ResumeEncryptionOptions<
  T extends MigrationDraftRecord,
> extends MigrationOptions<T> {
  context: WorkspaceCryptoContext;
}

export interface CancelEncryptionOptions<
  T extends MigrationDraftRecord,
> extends MigrationOptions<T> {
  context: WorkspaceCryptoContext;
}

export type BaseEncryptionState = "empty" | "plaintext" | "encrypted" | "mixed";

export interface BaseEncryptionInspection {
  state: BaseEncryptionState;
  keyIds: string[];
}

export async function enableEncryption<T extends MigrationDraftRecord>(
  options: EnableEncryptionOptions<T>
): Promise<EnableEncryptionResult> {
  const setup = await options.keyring.setup({
    passphrase: options.passphrase,
    ...(options.recoveryKey === undefined ? {} : { recoveryKey: options.recoveryKey }),
    state: "preparing",
  });

  options.onRecoveryKey?.(setup.recoveryKey);

  const record = await runMigration(options, setup.context, setup.record);

  return {
    record,
    context: setup.context,
    recoveryKey: setup.recoveryKey,
  };
}

export async function resumeEncryption<T extends MigrationDraftRecord>(
  options: ResumeEncryptionOptions<T>
): Promise<KeyringRecordV1> {
  const record = await options.keyring.get();

  if (record === null) {
    throw new CryptoError("keyring_missing", "The workspace keyring does not exist");
  }

  if (record.state === "active") {
    return record;
  }

  return runMigration(options, options.context, record);
}

export async function cancelEncryptionBeforeCommit<T extends MigrationDraftRecord>(
  options: CancelEncryptionOptions<T>
): Promise<void> {
  const record = await options.keyring.get();

  if (record === null) {
    throw new CryptoError("keyring_missing", "The workspace keyring does not exist");
  }

  if (record.state !== "preparing" && record.state !== "committing") {
    throw new CryptoError(
      "migration_state",
      "Encryption cannot be cancelled after the workspace commit"
    );
  }

  const workspaceId = options.keyring.workspaceId as WorkspaceId;
  const inspection = await inspectBaseEncryption(options.base, workspaceId);

  if (inspection.state === "encrypted" || inspection.state === "mixed") {
    throw new CryptoError(
      "base_encrypted",
      "Encryption cannot be cancelled after the workspace commit"
    );
  }

  if (options.drafts !== undefined) {
    const drafts = await options.drafts.encrypted.list();

    for (const draft of drafts) {
      try {
        await options.drafts.encrypted.remove(draft.workspaceId, draft.noteId);
      } catch (error) {
        throw migrationFailure("Encrypted draft cleanup failed", error);
      }
    }
  }

  await options.keyring.delete();
}

export async function inspectBaseEncryption(
  base: StorageAdapter,
  workspaceId: WorkspaceId
): Promise<BaseEncryptionInspection> {
  const notes = await listAllNotes(base, workspaceId);
  const files = await listAllFiles(base, workspaceId);
  const keyIds = new Set<string>();
  let plaintext = false;

  for (const note of notes) {
    if (!note.content.startsWith(TEXT_PREFIX)) {
      plaintext = true;
      continue;
    }

    try {
      keyIds.add(parseTextEnvelope(note.content).body.kid);
    } catch (error) {
      throw migrationFailure("A stored note envelope is invalid", error);
    }
  }

  const seenBlobs = new Set<BlobKey>();

  for (const file of files) {
    if (seenBlobs.has(file.blobKey)) {
      continue;
    }

    seenBlobs.add(file.blobKey);
    const blob = await base.blobs.get(file.blobKey);

    if (blob === null) {
      throw new CryptoError(
        "migration_failed",
        "A stored file is missing its encrypted blob"
      );
    }

    const data = new Uint8Array(await blob.arrayBuffer());

    if (!hasBinaryMagic(data)) {
      plaintext = true;
      continue;
    }

    try {
      keyIds.add(parseBinaryEnvelope(data).kid);
    } catch (error) {
      throw migrationFailure("A stored blob envelope is invalid", error);
    }
  }

  const ids = [...keyIds].sort();
  let state: BaseEncryptionState;

  if (ids.length === 0) {
    state = plaintext ? "plaintext" : "empty";
  } else {
    state = plaintext ? "mixed" : "encrypted";
  }

  return { state, keyIds: ids };
}

async function runMigration<T extends MigrationDraftRecord>(
  options: MigrationOptions<T>,
  context: WorkspaceCryptoContext,
  record: KeyringRecordV1
): Promise<KeyringRecordV1> {
  const workspaceId = options.keyring.workspaceId as WorkspaceId;

  try {
    if (record.state === "cleanup") {
      return cleanupMigration(options, context, workspaceId);
    }

    if (record.state === "committing") {
      const inspection = await inspectBaseEncryption(options.base, workspaceId);

      if (inspection.state === "mixed") {
        throw new CryptoError(
          "migration_state",
          "The workspace contains mixed plaintext and encrypted content"
        );
      }

      if (inspection.state === "encrypted") {
        await verifyEncryptedBase(options.base, context, workspaceId);
        await options.keyring.setState("cleanup");

        return cleanupMigration(options, context, workspaceId);
      }
    } else {
      const inspection = await inspectBaseEncryption(options.base, workspaceId);

      if (inspection.state === "encrypted" || inspection.state === "mixed") {
        throw new CryptoError(
          "base_encrypted",
          "The workspace is encrypted while the keyring is preparing"
        );
      }
    }

    report(options, "preparing", "start", 0, 1);

    if (options.drafts !== undefined) {
      await copyDrafts(options.drafts, (completed, total) => {
        report(options, "preparing", "drafts", completed, total);
      });
    }

    report(options, "preparing", "snapshot", 0, 1);
    const plaintext = await readSnapshot(options.base, workspaceId);
    const sealed = await sealSnapshot(plaintext, context);
    report(options, "preparing", "verify", 0, 1);
    await verifySealedSnapshot(sealed, plaintext, context);
    report(options, "preparing", "restore", 0, 1);

    await options.keyring.setState("committing");

    try {
      await options.base.restore(sealed);
    } catch (error) {
      throw migrationFailure("The encrypted workspace restore failed", error);
    }

    await options.keyring.setState("cleanup");

    return cleanupMigration(options, context, workspaceId);
  } catch (error) {
    if (error instanceof CryptoError) {
      throw error;
    }

    throw migrationFailure("The encryption migration failed", error);
  }
}

async function cleanupMigration<T extends MigrationDraftRecord>(
  options: MigrationOptions<T>,
  context: WorkspaceCryptoContext,
  workspaceId: WorkspaceId
): Promise<KeyringRecordV1> {
  try {
    await verifyEncryptedBase(options.base, context, workspaceId);
    report(options, "cleanup", "verify", 0, 1);

    if (options.drafts !== undefined) {
      await removePlaintextDrafts(options.drafts, (completed, total) => {
        report(options, "cleanup", "cleanup", completed, total);
      });
    }

    const knownKeys = await listBlobKeys(options.base, workspaceId);

    try {
      await options.base.blobs.purgeOrphans(knownKeys);
    } catch (error) {
      throw migrationFailure("Old encrypted blob cleanup failed", error);
    }

    report(options, "cleanup", "cleanup", 1, 1);
    const next = await options.keyring.setState("active");
    report(options, "active", "active", 1, 1);

    return next;
  } catch (error) {
    if (error instanceof CryptoError) {
      throw error;
    }

    throw migrationFailure("Encryption cleanup failed", error);
  }
}

async function copyDrafts<T extends MigrationDraftRecord>(
  drafts: MigrationDrafts<T>,
  onProgress: (completed: number, total: number) => void
): Promise<void> {
  const source = await drafts.plaintext.list();
  let completed = 0;

  onProgress(completed, source.length);

  for (const draft of source) {
    try {
      await drafts.encrypted.put(draft);

      const stored = await drafts.encrypted.get(draft.workspaceId, draft.noteId);

      if (stored === null || !sameDraft(draft, stored)) {
        throw new Error("The encrypted draft did not match its plaintext source");
      }
    } catch (error) {
      throw migrationFailure("Encrypted draft copy failed", error);
    }

    completed += 1;
    onProgress(completed, source.length);
  }
}

async function removePlaintextDrafts<T extends MigrationDraftRecord>(
  drafts: MigrationDrafts<T>,
  onProgress: (completed: number, total: number) => void
): Promise<void> {
  const source = await drafts.plaintext.list();
  let completed = 0;

  onProgress(completed, source.length);

  for (const draft of source) {
    try {
      const stored = await drafts.encrypted.get(draft.workspaceId, draft.noteId);

      if (stored === null || !sameDraft(draft, stored)) {
        await drafts.encrypted.put(draft);
        const verified = await drafts.encrypted.get(draft.workspaceId, draft.noteId);

        if (verified === null || !sameDraft(draft, verified)) {
          throw new Error("The encrypted draft could not be verified");
        }
      }

      await drafts.plaintext.remove(draft.workspaceId, draft.noteId);
    } catch (error) {
      throw migrationFailure("Plaintext draft cleanup failed", error);
    }

    completed += 1;
    onProgress(completed, source.length);
  }
}

export interface SnapshotReader {
  openNote(note: Note): Promise<string>;
  openBlob(key: BlobKey, data: Uint8Array): Promise<Uint8Array>;
}

export async function readSnapshot(
  base: StorageAdapter,
  workspaceId: WorkspaceId,
  reader?: SnapshotReader
): Promise<BackupSnapshot> {
  const workspace = await base.workspaces.get(workspaceId);

  if (workspace === null) {
    throw new CryptoError("migration_failed", "The workspace does not exist");
  }

  const [folders, files, rawNotes, tags] = await Promise.all([
    listAllFolders(base, workspaceId),
    listAllFiles(base, workspaceId),
    listAllNotes(base, workspaceId),
    listAllTags(base, workspaceId),
  ]);
  const notes: Note[] = [];

  for (const note of rawNotes) {
    notes.push(
      reader === undefined ? note : { ...note, content: await reader.openNote(note) }
    );
  }
  const fileTags: FileTag[] = [];

  for (const file of files) {
    for (const tag of await base.files.tags(file.id)) {
      fileTags.push({ fileId: file.id, tagId: tag.id });
    }
  }

  const noteTags: NoteTag[] = [];

  for (const note of notes) {
    for (const tag of await base.notes.tags(note.id)) {
      noteTags.push({ noteId: note.id, tagId: tag.id });
    }
  }

  const noteLinks: NoteLink[] = [];

  for (const note of notes) {
    noteLinks.push(...(await base.notes.links(note.id)));
  }

  const blobsByKey = new Map<BlobKey, BackupSnapshot["blobs"][number]>();

  for (const file of files) {
    if (blobsByKey.has(file.blobKey)) {
      continue;
    }

    const blob = await base.blobs.get(file.blobKey);

    if (blob === null) {
      throw new CryptoError("migration_failed", "A stored file blob is missing");
    }

    const data = new Uint8Array(await blob.arrayBuffer());

    blobsByKey.set(file.blobKey, {
      key: file.blobKey,
      mimeType: file.mimeType ?? blob.type,
      data: reader === undefined ? data : await reader.openBlob(file.blobKey, data),
    });
  }

  return {
    snapshotVersion: 1,
    schemaVersion: base.schemaVersion,
    kind: base.kind,
    createdAt: nowIso(),
    workspace,
    folders,
    files,
    notes,
    tags,
    fileTags,
    noteTags,
    noteLinks,
    blobs: [...blobsByKey.values()],
  };
}

export async function sealSnapshot(
  snapshot: BackupSnapshot,
  context: WorkspaceCryptoContext
): Promise<BackupSnapshot> {
  const workspaceId = context.workspaceId as WorkspaceId;
  const blobKeys = new Map<BlobKey, BlobKey>();
  const checksums = new Map<BlobKey, string>();
  const blobs: BackupSnapshot["blobs"] = [];

  for (const blob of snapshot.blobs) {
    if (blobKeys.has(blob.key)) {
      continue;
    }

    const key = generateId() as BlobKey;
    blobKeys.set(blob.key, key);
    const data = await sealBytes({
      context: blobContext(context, key),
      dek: context.dek,
      keyId: context.keyId,
      plaintext: blob.data,
    });

    checksums.set(key, await checksumOf(data));
    blobs.push({ key, mimeType: blob.mimeType, data });
  }

  const notes: Note[] = [];

  for (const note of snapshot.notes) {
    notes.push({
      ...note,
      workspaceId,
      content: await sealText({
        context: noteContext(context, note.id),
        dek: context.dek,
        keyId: context.keyId,
        plaintext: note.content,
      }),
    });
  }

  const files = snapshot.files.map((file) => {
    const blobKey = blobKeys.get(file.blobKey);

    if (blobKey === undefined) {
      throw new CryptoError(
        "migration_failed",
        "A file refers to a blob that is missing from the snapshot"
      );
    }

    return {
      ...file,
      workspaceId,
      blobKey,
      checksum: checksums.get(blobKey) ?? null,
    };
  });

  return {
    ...snapshot,
    blobEncoding: "encrypted",
    workspace: { ...snapshot.workspace, id: workspaceId },
    folders: snapshot.folders.map((folder) => ({ ...folder, workspaceId })),
    files,
    notes,
    tags: snapshot.tags.map((tag) => ({ ...tag, workspaceId })),
    blobs,
  };
}

export async function verifySealedSnapshot(
  snapshot: BackupSnapshot,
  plaintext: BackupSnapshot,
  context: WorkspaceCryptoContext
): Promise<void> {
  const noteContents = new Map(plaintext.notes.map((note) => [note.id, note.content]));

  for (const note of snapshot.notes) {
    const opened = await openText({
      context: noteContext(context, note.id),
      dek: context.dek,
      keyId: context.keyId,
      envelope: note.content,
    });

    if (opened !== noteContents.get(note.id)) {
      throw new CryptoError("migration_state", "The encrypted note failed verification");
    }
  }

  const blobData = new Map(plaintext.blobs.map((blob) => [blob.key, blob.data]));
  const blobKeys = new Map(
    plaintext.files.map((file) => [file.id, file.blobKey] as const)
  );

  for (const file of snapshot.files) {
    const oldKey = blobKeys.get(file.id);
    const expected = oldKey === undefined ? undefined : blobData.get(oldKey);

    if (expected === undefined) {
      throw new CryptoError(
        "migration_state",
        "The encrypted file is missing its source"
      );
    }

    const opened = await openBytes({
      context: blobContext(context, file.blobKey),
      dek: context.dek,
      keyId: context.keyId,
      envelope:
        snapshot.blobs.find((blob) => blob.key === file.blobKey)?.data ??
        new Uint8Array(),
    });

    if (!sameBytes(opened, expected)) {
      throw new CryptoError("migration_state", "The encrypted file failed verification");
    }
  }
}

async function verifyEncryptedBase(
  base: StorageAdapter,
  context: WorkspaceCryptoContext,
  workspaceId: WorkspaceId
): Promise<void> {
  const notes = await listAllNotes(base, workspaceId);

  for (const note of notes) {
    await openText({
      context: noteContext(context, note.id),
      dek: context.dek,
      keyId: context.keyId,
      envelope: note.content,
    });
  }

  const seenBlobs = new Set<BlobKey>();

  for (const file of await listAllFiles(base, workspaceId)) {
    if (seenBlobs.has(file.blobKey)) {
      continue;
    }

    seenBlobs.add(file.blobKey);
    const blob = await base.blobs.get(file.blobKey);

    if (blob === null) {
      throw new CryptoError("migration_state", "An encrypted file blob is missing");
    }

    await openBytes({
      context: blobContext(context, file.blobKey),
      dek: context.dek,
      keyId: context.keyId,
      envelope: new Uint8Array(await blob.arrayBuffer()),
    });
  }
}

async function listBlobKeys(
  base: StorageAdapter,
  workspaceId: WorkspaceId
): Promise<BlobKey[]> {
  const keys = new Set<BlobKey>();

  for (const file of await listAllFiles(base, workspaceId)) {
    keys.add(file.blobKey);
  }

  return [...keys];
}

async function listAllNotes(
  base: StorageAdapter,
  workspaceId: WorkspaceId
): Promise<Note[]> {
  return listAll((options) => base.notes.list(workspaceId, {}, options));
}

async function listAllFolders(
  base: StorageAdapter,
  workspaceId: WorkspaceId
): Promise<BackupSnapshot["folders"]> {
  return listAll((options) => base.folders.list(workspaceId, options));
}

async function listAllFiles(
  base: StorageAdapter,
  workspaceId: WorkspaceId
): Promise<BackupSnapshot["files"]> {
  return listAll((options) => base.files.list(workspaceId, {}, options));
}

async function listAllTags(
  base: StorageAdapter,
  workspaceId: WorkspaceId
): Promise<BackupSnapshot["tags"]> {
  return listAll((options) => base.tags.list(workspaceId, options));
}

async function listAll<T>(
  load: (options: ListOptions) => Promise<Page<T>>
): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | null = null;

  for (;;) {
    const page = await load({
      limit: PAGE_SIZE,
      ...(cursor === null ? {} : { cursor }),
    });
    items.push(...page.items);

    if (page.nextCursor === null || page.nextCursor === cursor) {
      return items;
    }

    cursor = page.nextCursor;
  }
}

function sameDraft<T extends MigrationDraftRecord>(left: T, right: T): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.length === right.length && left.every((byte, index) => byte === right[index])
  );
}

function hasBinaryMagic(data: Uint8Array): boolean {
  return (
    data.length >= BINARY_MAGIC.length &&
    BINARY_MAGIC.every((byte, index) => data[index] === byte)
  );
}

function noteContext(context: WorkspaceCryptoContext, noteId: string) {
  return {
    workspaceId: context.workspaceId,
    purpose: "note-content",
    entityType: "note",
    entityId: noteId,
  };
}

function blobContext(context: WorkspaceCryptoContext, blobKey: string) {
  return {
    workspaceId: context.workspaceId,
    purpose: "file-bytes",
    entityType: "blob",
    entityId: blobKey,
  };
}

async function checksumOf(data: Uint8Array): Promise<string> {
  const digest = await getWebCrypto().subtle.digest("SHA-256", Uint8Array.from(data));

  return bytesToHex(new Uint8Array(digest));
}

function report<T extends MigrationDraftRecord>(
  options: MigrationOptions<T>,
  state: EncryptionState,
  phase: MigrationPhase,
  completed: number,
  total: number
): void {
  options.onProgress?.({ state, phase, completed, total });
}

function migrationFailure(message: string, cause: unknown): CryptoError {
  return new CryptoError("migration_failed", message, { cause });
}

function nowIso(): IsoDate {
  return new Date().toISOString() as IsoDate;
}
