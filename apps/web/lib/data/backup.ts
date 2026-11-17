import {
  limits,
  type BackupSnapshot,
  type Page,
  type StorageAdapter,
  type WorkspaceId,
} from "@opennest/core";
import {
  canonicalJsonBytes,
  openBackup,
  sealBackup,
  CryptoError,
  type BackupKeySource,
} from "@opennest/crypto";
import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  backupFileSchema,
  backupFileV2Schema,
  backupSnapshotSchema,
  serializedBackupSnapshotSchema,
  type BackupFile,
  type BackupFileV2,
} from "@opennest/validation";

import { errorKey } from "../errors";
import { browserClock, sha256Hex } from "./services";

export { createBackupKey } from "@opennest/crypto";
export type { BackupKeySource } from "@opennest/crypto";

export type BackupErrorCode =
  | "missingWorkspace"
  | "missingBlob"
  | "exportFailed"
  | "invalidJson"
  | "invalidFormat"
  | "unsupportedVersion"
  | "invalidBlob"
  | "invalidSnapshot"
  | "checksumMismatch"
  | "missingKey"
  | "wrongKey"
  | "invalidEncryption"
  | "invalidSummary";

export class BackupError extends Error {
  constructor(
    readonly code: BackupErrorCode,
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = "BackupError";
  }
}

export interface BackupSummary {
  files: number;
  notes: number;
  folders: number;
  tags: number;
}

export type BackupInspection =
  | { formatVersion: 1; exportedAt: string; encrypted: false }
  | {
      formatVersion: 2;
      exportedAt: string;
      encrypted: true;
      chunkCount: number;
      chunkSize: number;
      summary: BackupFileV2["summary"];
    };

interface BuiltBackupBase {
  fileName: string;
  text: string;
  snapshot: BackupSnapshot;
  summary: BackupSummary;
}

export interface BuiltPlaintextBackup extends BuiltBackupBase {
  formatVersion: 1;
  encrypted: false;
}

export interface BuiltEncryptedBackup extends BuiltBackupBase {
  formatVersion: 2;
  encrypted: true;
  keyId: string;
}

export type BuiltBackup = BuiltPlaintextBackup | BuiltEncryptedBackup;

export interface BuildBackupOptions {
  now?: () => string;
}

export type BackupExportOptions =
  { format?: "v1" } | { format: "v2"; keySource: BackupKeySource };

export interface BuildBackupV2Options extends BuildBackupOptions {
  chunkSize?: number;
  kid?: string;
}

export interface ParseBackupOptions {
  targetWorkspaceId?: WorkspaceId;
}

export function backupErrorKey(error: unknown): string {
  if (error instanceof BackupError) {
    return `backup.errors.${error.code}`;
  }

  return errorKey(error);
}

export function backupFileName(iso: string): string {
  return `opennest-backup-${iso.slice(0, 10)}.json`;
}

export function summarizeBackup(snapshot: BackupSnapshot): BackupSummary {
  return {
    files: snapshot.files.length,
    notes: snapshot.notes.length,
    folders: snapshot.folders.length,
    tags: snapshot.tags.length,
  };
}

export async function buildBackup(
  storage: StorageAdapter,
  workspaceId: WorkspaceId,
  options: BuildBackupOptions = {}
): Promise<BuiltPlaintextBackup> {
  const { createdAt, snapshot } = await buildBackupSnapshot(
    storage,
    workspaceId,
    options
  );

  return {
    formatVersion: 1,
    encrypted: false,
    fileName: backupFileName(createdAt),
    text: serializeBackup(snapshot),
    snapshot,
    summary: summarizeBackup(snapshot),
  };
}

export async function buildBackupV2(
  snapshot: BackupSnapshot,
  keySource: BackupKeySource,
  options: BuildBackupV2Options = {}
): Promise<BuiltEncryptedBackup> {
  const now = options.now ?? browserClock;
  const parsed = backupSnapshotSchema.safeParse(snapshot);

  if (!parsed.success) {
    throw new BackupError("exportFailed", "The library could not be exported.", {
      cause: parsed.error,
    });
  }

  const createdAt = now();
  const payload = serializeSnapshot(parsed.data);
  const sealed = await sealBackup({
    payload: canonicalJsonBytes(payload),
    exportedAt: createdAt,
    counts: {
      files: parsed.data.files.length,
      notes: parsed.data.notes.length,
      folders: parsed.data.folders.length,
      tags: parsed.data.tags.length,
    },
    keySource,
    ...(options.chunkSize === undefined ? {} : { chunkSize: options.chunkSize }),
    ...(options.kid === undefined ? {} : { kid: options.kid }),
  });

  const envelope = backupFileV2Schema.parse(sealed.envelope);

  return {
    formatVersion: 2,
    encrypted: true,
    keyId: envelope.encryption.kid,
    fileName: backupFileName(createdAt),
    text: serializeEnvelope(envelope),
    snapshot: parsed.data,
    summary: summarizeBackup(parsed.data),
  };
}

export function inspectBackupFile(text: string): BackupInspection {
  return readBackup(text).inspection;
}

export async function parseBackupFile(
  text: string,
  keySource?: BackupKeySource,
  options: ParseBackupOptions = {}
): Promise<BackupSnapshot> {
  const read = readBackup(text);

  if ("snapshot" in read.file) {
    return parseV1(read.file, options);
  }

  if (keySource === undefined) {
    throw new BackupError("missingKey", "This backup needs a passphrase or backup key.");
  }

  let opened: Awaited<ReturnType<typeof openBackup>>;

  try {
    opened = await openBackup({ envelope: read.file, keySource });
  } catch (error) {
    if (
      error instanceof CryptoError &&
      (error.code === "authentication_failed" ||
        error.code === "invalid_recovery_key" ||
        error.code === "invalid_passphrase")
    ) {
      throw new BackupError(
        "wrongKey",
        "The backup key is incorrect or the backup is damaged.",
        { cause: error }
      );
    }

    throw new BackupError(
      "invalidEncryption",
      "The encrypted backup header or chunk is invalid.",
      { cause: error }
    );
  }

  return parseV2(
    opened.payload,
    read.file,
    opened.envelope.summary.totalPlaintextBytes,
    options
  );
}

export function mapBackupToWorkspace(
  snapshot: BackupSnapshot,
  targetWorkspaceId: WorkspaceId
): BackupSnapshot {
  const mapped: BackupSnapshot = {
    ...snapshot,
    workspace: { ...snapshot.workspace, id: targetWorkspaceId },
    folders: snapshot.folders.map((folder) => ({
      ...folder,
      workspaceId: targetWorkspaceId,
    })),
    files: snapshot.files.map((file) => ({
      ...file,
      workspaceId: targetWorkspaceId,
    })),
    notes: snapshot.notes.map((note) => ({
      ...note,
      workspaceId: targetWorkspaceId,
    })),
    tags: snapshot.tags.map((tag) => ({
      ...tag,
      workspaceId: targetWorkspaceId,
    })),
  };
  delete mapped.blobEncoding;

  return mapped;
}

export function downloadTextFile(fileName: string, text: string): void {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function buildBackupSnapshot(
  storage: StorageAdapter,
  workspaceId: WorkspaceId,
  options: BuildBackupOptions
): Promise<{ createdAt: string; snapshot: BackupSnapshot }> {
  const now = options.now ?? browserClock;
  const workspace = await storage.workspaces.get(workspaceId);

  if (workspace === null) {
    throw new BackupError("missingWorkspace", "The workspace does not exist.");
  }

  const [folders, files, notes, tags] = await Promise.all([
    listAll((cursor) =>
      storage.folders.list(workspaceId, { limit: limits.maxPageSize, cursor })
    ),
    listAll((cursor) =>
      storage.files.list(workspaceId, {}, { limit: limits.maxPageSize, cursor })
    ),
    listAll((cursor) =>
      storage.notes.list(workspaceId, {}, { limit: limits.maxPageSize, cursor })
    ),
    listAll((cursor) =>
      storage.tags.list(workspaceId, { limit: limits.maxPageSize, cursor })
    ),
  ]);

  const fileTags = (
    await Promise.all(
      files.map(async (file) =>
        (await storage.files.tags(file.id)).map((tag) => ({
          fileId: file.id,
          tagId: tag.id,
        }))
      )
    )
  )
    .flat()
    .sort(compareFileTags);
  const noteTags = (
    await Promise.all(
      notes.map(async (note) =>
        (await storage.notes.tags(note.id)).map((tag) => ({
          noteId: note.id,
          tagId: tag.id,
        }))
      )
    )
  )
    .flat()
    .sort(compareNoteTags);
  const noteLinks = (await Promise.all(notes.map((note) => storage.notes.links(note.id))))
    .flat()
    .sort(compareNoteLinks);

  const blobsByKey = new Map<string, BackupSnapshot["blobs"][number]>();

  for (const file of files) {
    if (blobsByKey.has(file.blobKey)) {
      continue;
    }

    const blob = await storage.blobs.get(file.blobKey);

    if (blob === null) {
      throw new BackupError("missingBlob", `The stored copy of ${file.name} is missing.`);
    }

    blobsByKey.set(file.blobKey, {
      key: file.blobKey,
      mimeType: file.mimeType ?? blob.type,
      data: new Uint8Array(await blob.arrayBuffer()),
    });
  }

  const checksums = new Map<string, string>();

  for (const [key, blob] of blobsByKey) {
    checksums.set(key, await sha256Hex(blob.data));
  }

  const createdAt = now();
  const candidate = {
    snapshotVersion: 1 as const,
    schemaVersion: storage.schemaVersion,
    kind: storage.kind,
    createdAt,
    workspace,
    folders,
    files: files.map((file) => ({
      ...file,
      checksum: checksums.get(file.blobKey) ?? null,
    })),
    notes,
    tags,
    fileTags,
    noteTags,
    noteLinks,
    blobs: [...blobsByKey.values()],
  };
  const parsed = backupSnapshotSchema.safeParse(candidate);

  if (!parsed.success) {
    throw new BackupError("exportFailed", "The library could not be exported.", {
      cause: parsed.error,
    });
  }

  return { createdAt, snapshot: parsed.data };
}

function readBackup(text: string):
  | {
      inspection: Extract<BackupInspection, { formatVersion: 1 }>;
      file: BackupFile;
    }
  | {
      inspection: Extract<BackupInspection, { formatVersion: 2 }>;
      file: BackupFileV2;
    } {
  let raw: unknown;

  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new BackupError("invalidJson", "The backup file is not valid JSON.", {
      cause: error,
    });
  }

  if (typeof raw !== "object" || raw === null) {
    throw new BackupError("invalidFormat", "The backup file has an invalid format.");
  }

  const record = raw as { format?: unknown; formatVersion?: unknown };

  if (record.format !== BACKUP_FORMAT) {
    throw new BackupError("invalidFormat", "The backup file has an invalid format.");
  }

  if (record.formatVersion !== 1 && record.formatVersion !== 2) {
    throw new BackupError(
      "unsupportedVersion",
      "This backup was made by an unsupported version of OpenNest."
    );
  }

  if (record.formatVersion === 1) {
    const parsed = backupFileSchema.safeParse(raw);

    if (!parsed.success) {
      throw new BackupError("invalidFormat", "The backup file has an invalid format.", {
        cause: parsed.error,
      });
    }

    return {
      inspection: {
        formatVersion: 1,
        exportedAt: parsed.data.exportedAt,
        encrypted: false,
      },
      file: parsed.data,
    };
  }

  const parsed = backupFileV2Schema.safeParse(raw);

  if (!parsed.success) {
    throw new BackupError(
      "invalidEncryption",
      "The encrypted backup header is invalid.",
      { cause: parsed.error }
    );
  }

  return {
    inspection: {
      formatVersion: 2,
      exportedAt: parsed.data.exportedAt,
      encrypted: true,
      chunkCount: parsed.data.chunkCount,
      chunkSize: parsed.data.chunkSize,
      summary: parsed.data.summary,
    },
    file: parsed.data,
  };
}

async function parseV1(
  file: BackupFile,
  options: ParseBackupOptions
): Promise<BackupSnapshot> {
  const serialized = file.snapshot;
  const blobs = serialized.blobs.map((blob) => ({
    key: blob.key,
    mimeType: blob.mimeType,
    data: decodeBase64(blob.data),
  }));
  const snapshotResult = backupSnapshotSchema.safeParse({ ...serialized, blobs });

  if (!snapshotResult.success) {
    throw new BackupError("invalidSnapshot", "The backup contents are not valid.", {
      cause: snapshotResult.error,
    });
  }

  await assertChecksums(snapshotResult.data);

  return options.targetWorkspaceId === undefined
    ? snapshotResult.data
    : mapBackupToWorkspace(snapshotResult.data, options.targetWorkspaceId);
}

async function parseV2(
  payload: Uint8Array,
  file: BackupFileV2,
  totalPlaintextBytes: number,
  options: ParseBackupOptions
): Promise<BackupSnapshot> {
  let value: unknown;

  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payload));
  } catch (error) {
    throw new BackupError("invalidSnapshot", "The backup payload is not valid.", {
      cause: error,
    });
  }

  const serialized = serializedBackupSnapshotSchema.safeParse(value);

  if (!serialized.success) {
    throw new BackupError("invalidSnapshot", "The backup contents are not valid.", {
      cause: serialized.error,
    });
  }

  const snapshotValue = serialized.data;
  const blobs = snapshotValue.blobs.map((blob) => ({
    key: blob.key,
    mimeType: blob.mimeType,
    data: decodeBase64(blob.data),
  }));
  const snapshotResult = backupSnapshotSchema.safeParse({
    ...snapshotValue,
    blobs,
  });

  if (!snapshotResult.success) {
    throw new BackupError("invalidSnapshot", "The backup contents are not valid.", {
      cause: snapshotResult.error,
    });
  }

  const snapshot = snapshotResult.data;
  const counts = file.summary.counts;

  if (
    counts.folders !== snapshot.folders.length ||
    counts.tags !== snapshot.tags.length ||
    counts.files !== snapshot.files.length ||
    counts.notes !== snapshot.notes.length ||
    totalPlaintextBytes !== payload.length
  ) {
    throw new BackupError("invalidSummary", "The backup summary does not match.");
  }

  await assertChecksums(snapshot);

  return options.targetWorkspaceId === undefined
    ? snapshot
    : mapBackupToWorkspace(snapshot, options.targetWorkspaceId);
}

function serializeSnapshot(snapshot: BackupSnapshot): Record<string, unknown> {
  return {
    ...snapshot,
    blobs: snapshot.blobs.map((blob) => ({
      key: blob.key,
      mimeType: blob.mimeType,
      data: encodeBase64(blob.data),
    })),
  };
}

function serializeBackup(snapshot: BackupSnapshot): string {
  const payload = {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: snapshot.createdAt,
    snapshot: serializeSnapshot(snapshot),
  };

  return `${JSON.stringify(payload, null, 2)}\n`;
}

function serializeEnvelope(envelope: BackupFileV2): string {
  return `${JSON.stringify(envelope, null, 2)}\n`;
}

async function assertChecksums(snapshot: BackupSnapshot): Promise<void> {
  const blobsByKey = new Map<string, BackupSnapshot["blobs"][number]>();

  for (const blob of snapshot.blobs) {
    if (blobsByKey.has(blob.key)) {
      throw new BackupError("invalidSnapshot", "A file blob appears twice.");
    }

    blobsByKey.set(blob.key, blob);
  }

  for (const file of snapshot.files) {
    const blob = blobsByKey.get(file.blobKey);

    if (blob === undefined) {
      throw new BackupError("invalidSnapshot", "A file blob is missing.");
    }

    if (file.checksum !== null && (await sha256Hex(blob.data)) !== file.checksum) {
      throw new BackupError(
        "checksumMismatch",
        `The stored copy of ${file.name} does not match its checksum.`
      );
    }
  }
}

async function listAll<T>(
  load: (cursor: string | null) => Promise<Page<T>>
): Promise<T[]> {
  const rows: T[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;

  do {
    const page = await load(cursor);
    rows.push(...page.items);
    cursor = page.nextCursor;

    if (cursor !== null) {
      if (seen.has(cursor)) {
        throw new BackupError("exportFailed", "Pagination did not make progress.");
      }
      seen.add(cursor);
    }
  } while (cursor !== null);

  return rows;
}

function decodeBase64(value: string): Uint8Array {
  if (
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) {
    throw new BackupError("invalidBlob", "A file blob is not valid base64.");
  }

  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }

    return bytes;
  } catch (error) {
    throw new BackupError("invalidBlob", "A file blob is not valid base64.", {
      cause: error,
    });
  }
}

function encodeBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = "";

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return btoa(binary);
}

function compareFileTags(
  left: { fileId: string; tagId: string },
  right: { fileId: string; tagId: string }
): number {
  return left.fileId.localeCompare(right.fileId) || left.tagId.localeCompare(right.tagId);
}

function compareNoteTags(
  left: { noteId: string; tagId: string },
  right: { noteId: string; tagId: string }
): number {
  return left.noteId.localeCompare(right.noteId) || left.tagId.localeCompare(right.tagId);
}

function compareNoteLinks(
  left: { sourceNoteId: string; targetNoteId: string },
  right: { sourceNoteId: string; targetNoteId: string }
): number {
  return (
    left.sourceNoteId.localeCompare(right.sourceNoteId) ||
    left.targetNoteId.localeCompare(right.targetNoteId)
  );
}
