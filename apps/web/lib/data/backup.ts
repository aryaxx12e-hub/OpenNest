import {
  limits,
  type BackupSnapshot,
  type Page,
  type StorageAdapter,
  type WorkspaceId,
} from "@opennest/core";
import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  backupFileSchema,
  backupSnapshotSchema,
} from "@opennest/validation";

import { errorKey } from "../errors";
import { browserClock, sha256Hex } from "./services";

export type BackupErrorCode =
  | "missingWorkspace"
  | "missingBlob"
  | "exportFailed"
  | "invalidJson"
  | "invalidFormat"
  | "unsupportedVersion"
  | "invalidBlob"
  | "invalidSnapshot"
  | "checksumMismatch";

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

export interface BuiltBackup {
  fileName: string;
  text: string;
  snapshot: BackupSnapshot;
  summary: BackupSummary;
}

export interface BuildBackupOptions {
  now?: () => string;
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
): Promise<BuiltBackup> {
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

  const createdAt = now();
  const candidate = {
    snapshotVersion: 1 as const,
    schemaVersion: storage.schemaVersion,
    kind: storage.kind,
    createdAt,
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
  const parsed = backupSnapshotSchema.safeParse(candidate);

  if (!parsed.success) {
    throw new BackupError("exportFailed", "The library could not be exported.", {
      cause: parsed.error,
    });
  }

  return {
    fileName: backupFileName(createdAt),
    text: serializeBackup(parsed.data),
    snapshot: parsed.data,
    summary: summarizeBackup(parsed.data),
  };
}

export async function parseBackupFile(text: string): Promise<BackupSnapshot> {
  let raw: unknown;

  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new BackupError("invalidJson", "The backup file is not valid JSON.", {
      cause: error,
    });
  }

  if (
    typeof raw === "object" &&
    raw !== null &&
    (raw as { format?: unknown }).format === BACKUP_FORMAT &&
    (raw as { formatVersion?: unknown }).formatVersion !== BACKUP_FORMAT_VERSION
  ) {
    throw new BackupError(
      "unsupportedVersion",
      "This backup was made by an unsupported version of OpenNest."
    );
  }

  const parsed = backupFileSchema.safeParse(raw);

  if (!parsed.success) {
    throw new BackupError("invalidFormat", "The backup file has an invalid format.", {
      cause: parsed.error,
    });
  }

  const serialized = parsed.data.snapshot;
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

  return snapshotResult.data;
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

function serializeBackup(snapshot: BackupSnapshot): string {
  const payload = {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: snapshot.createdAt,
    snapshot: {
      ...snapshot,
      blobs: snapshot.blobs.map((blob) => ({
        key: blob.key,
        mimeType: blob.mimeType,
        data: encodeBase64(blob.data),
      })),
    },
  };

  return `${JSON.stringify(payload, null, 2)}\n`;
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
