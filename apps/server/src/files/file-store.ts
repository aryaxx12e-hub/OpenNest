import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const SCHEMA = readFileSync(
  fileURLToPath(new URL("./schema.sql", import.meta.url)),
  "utf8"
);

const REQUIRED_TABLES = ["workspaces", "folders", "files"] as const;

export interface FileWorkspaceRecord {
  id: string;
  name: string;
}

export interface StoredFileRecord {
  id: string;
  workspaceId: string;
  folderId: string | null;
  name: string;
  mimeType: string;
  sizeBytes: number;
  blobKey: string;
  checksum: string;
  createdAt: string;
  updatedAt: string;
}

export interface FileVersionRecord {
  id: string;
  fileId: string;
  workspaceId: string;
  versionNumber: number;
  blobKey: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
  uploadedBy: string;
  createdAt: string;
}

interface FileRow {
  id: string;
  workspace_id: string;
  folder_id: string | null;
  name: string;
  mime_type: string | null;
  size_bytes: number;
  blob_key: string;
  checksum: string | null;
  created_at: string;
  updated_at: string;
}

interface VersionRow {
  id: string;
  file_id: string;
  workspace_id: string;
  version_number: number;
  blob_key: string;
  name: string;
  mime_type: string;
  size_bytes: number;
  checksum: string;
  uploaded_by: string;
  created_at: string;
}

export interface FileStore {
  readonly databaseFile: string;
  readonly sqlite: DatabaseSync;
  transaction<T>(work: () => T): T;
  primaryWorkspace(): FileWorkspaceRecord | null;
  getWorkspace(workspaceId: string): FileWorkspaceRecord | null;
  folderExists(workspaceId: string, folderId: string): boolean;
  getFile(workspaceId: string, fileId: string): StoredFileRecord | null;
  getVersion(workspaceId: string, versionId: string): FileVersionRecord | null;
  latestVersion(fileId: string): FileVersionRecord | null;
  listVersions(workspaceId: string, fileId: string): FileVersionRecord[];
  insertFile(file: StoredFileRecord): void;
  updateFile(file: StoredFileRecord): void;
  insertVersion(version: FileVersionRecord): void;
  close(): void;
}

export interface OpenFileStoreOptions {
  databaseFile: string;
}

function tryRollback(sqlite: DatabaseSync): boolean {
  try {
    sqlite.exec("ROLLBACK");
    return true;
  } catch {
    return false;
  }
}

function requiresTables(sqlite: DatabaseSync): void {
  const statement = sqlite.prepare(
    "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?"
  );

  for (const table of REQUIRED_TABLES) {
    if (statement.get(table) === undefined) {
      throw new Error("The workspace file schema is incomplete.");
    }
  }
}

function toFile(row: FileRow): StoredFileRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    folderId: row.folder_id,
    name: row.name,
    mimeType: row.mime_type ?? "",
    sizeBytes: Number(row.size_bytes),
    blobKey: row.blob_key,
    checksum: row.checksum ?? "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toVersion(row: VersionRow): FileVersionRecord {
  return {
    id: row.id,
    fileId: row.file_id,
    workspaceId: row.workspace_id,
    versionNumber: Number(row.version_number),
    blobKey: row.blob_key,
    name: row.name,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    checksum: row.checksum,
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at,
  };
}

export function openFileStore(options: OpenFileStoreOptions): FileStore {
  mkdirSync(path.dirname(options.databaseFile), { recursive: true, mode: 0o700 });
  const sqlite = new DatabaseSync(options.databaseFile);

  try {
    sqlite.exec("PRAGMA foreign_keys = ON");
    sqlite.exec("PRAGMA journal_mode = WAL");
    sqlite.exec("PRAGMA busy_timeout = 5000");
    requiresTables(sqlite);
    sqlite.exec(SCHEMA);
  } catch (error) {
    sqlite.close();
    throw error;
  }

  return {
    databaseFile: options.databaseFile,
    sqlite,
    transaction<T>(work: () => T): T {
      sqlite.exec("BEGIN IMMEDIATE");

      try {
        const result = work();
        sqlite.exec("COMMIT");
        return result;
      } catch (error) {
        if (!tryRollback(sqlite)) {
          throw new Error("The file transaction could not be rolled back.", {
            cause: error,
          });
        }

        throw error;
      }
    },
    primaryWorkspace() {
      const row = sqlite
        .prepare("SELECT id, name FROM workspaces ORDER BY created_at, rowid LIMIT 1")
        .get() as { id: string; name: string } | undefined;

      return row === undefined ? null : { id: row.id, name: row.name };
    },
    getWorkspace(workspaceId) {
      const row = sqlite
        .prepare("SELECT id, name FROM workspaces WHERE id = ?")
        .get(workspaceId) as { id: string; name: string } | undefined;

      return row === undefined ? null : { id: row.id, name: row.name };
    },
    folderExists(workspaceId, folderId) {
      const row = sqlite
        .prepare("SELECT 1 AS present FROM folders WHERE id = ? AND workspace_id = ?")
        .get(folderId, workspaceId) as { present: number } | undefined;

      return row !== undefined;
    },
    getFile(workspaceId, fileId) {
      const row = sqlite
        .prepare(
          "SELECT id, workspace_id, folder_id, name, mime_type, size_bytes, blob_key, checksum, created_at, updated_at FROM files WHERE id = ? AND workspace_id = ?"
        )
        .get(fileId, workspaceId) as FileRow | undefined;

      return row === undefined ? null : toFile(row);
    },
    getVersion(workspaceId, versionId) {
      const row = sqlite
        .prepare(
          "SELECT id, file_id, workspace_id, version_number, blob_key, name, mime_type, size_bytes, checksum, uploaded_by, created_at FROM file_versions WHERE id = ? AND workspace_id = ?"
        )
        .get(versionId, workspaceId) as VersionRow | undefined;

      return row === undefined ? null : toVersion(row);
    },
    latestVersion(fileId) {
      const row = sqlite
        .prepare(
          "SELECT id, file_id, workspace_id, version_number, blob_key, name, mime_type, size_bytes, checksum, uploaded_by, created_at FROM file_versions WHERE file_id = ? ORDER BY version_number DESC LIMIT 1"
        )
        .get(fileId) as VersionRow | undefined;

      return row === undefined ? null : toVersion(row);
    },
    listVersions(workspaceId, fileId) {
      const rows = sqlite
        .prepare(
          "SELECT id, file_id, workspace_id, version_number, blob_key, name, mime_type, size_bytes, checksum, uploaded_by, created_at FROM file_versions WHERE workspace_id = ? AND file_id = ? ORDER BY version_number"
        )
        .all(workspaceId, fileId) as unknown as VersionRow[];

      return rows.map(toVersion);
    },
    insertFile(file) {
      sqlite
        .prepare(
          "INSERT INTO files (id, workspace_id, folder_id, name, mime_type, size_bytes, blob_key, checksum, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .run(
          file.id,
          file.workspaceId,
          file.folderId,
          file.name,
          file.mimeType,
          file.sizeBytes,
          file.blobKey,
          file.checksum,
          file.createdAt,
          file.updatedAt
        );
    },
    updateFile(file) {
      sqlite
        .prepare(
          "UPDATE files SET folder_id = ?, name = ?, mime_type = ?, size_bytes = ?, blob_key = ?, checksum = ?, updated_at = ? WHERE id = ? AND workspace_id = ?"
        )
        .run(
          file.folderId,
          file.name,
          file.mimeType,
          file.sizeBytes,
          file.blobKey,
          file.checksum,
          file.updatedAt,
          file.id,
          file.workspaceId
        );
    },
    insertVersion(version) {
      sqlite
        .prepare(
          "INSERT INTO file_versions (id, file_id, workspace_id, version_number, blob_key, name, mime_type, size_bytes, checksum, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .run(
          version.id,
          version.fileId,
          version.workspaceId,
          version.versionNumber,
          version.blobKey,
          version.name,
          version.mimeType,
          version.sizeBytes,
          version.checksum,
          version.uploadedBy,
          version.createdAt
        );
    },
    close() {
      sqlite.close();
    },
  };
}
