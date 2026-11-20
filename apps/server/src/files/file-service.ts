import { createHash, randomUUID } from "node:crypto";
import { readdir, rm } from "node:fs/promises";
import path from "node:path";

import { limits, validateDisplayName, type BlobKey } from "@opennest/core";
import { FileSystemBlobStore } from "@opennest/storage-sqlite";

import type { Role } from "../auth/membership";
import type {
  FileStore,
  FileVersionRecord,
  FileWorkspaceRecord,
  StoredFileRecord,
} from "./file-store";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CONFLICT_SUFFIX = " (conflict copy)";

export type FileServiceErrorCode =
  | "forbidden"
  | "file_too_large"
  | "unsupported_mime_type"
  | "invalid_file_name"
  | "invalid_file_id"
  | "invalid_version_id"
  | "invalid_folder_id"
  | "invalid_base_version"
  | "base_version_required"
  | "folder_not_found"
  | "workspace_not_found"
  | "not_found"
  | "storage_error";

export class FileServiceError extends Error {
  readonly code: FileServiceErrorCode;

  constructor(code: FileServiceErrorCode, message: string) {
    super(message);
    this.name = "FileServiceError";
    this.code = code;
  }
}

export interface FileUploadInput {
  workspaceId: string;
  actorId: string;
  role: Role;
  folderId: string | null;
  fileId?: string;
  baseVersionId?: string | null;
  name: string;
  mimeType: string;
  data: Uint8Array;
}

export interface FileUploadResult {
  file: StoredFileRecord;
  version: FileVersionRecord;
  conflict: boolean;
  conflictOf: string | null;
}

export interface FileDownloadInput {
  workspaceId: string;
  fileId: string;
  versionId?: string;
}

export interface FileDownloadResult {
  file: StoredFileRecord;
  version: FileVersionRecord;
  data: Uint8Array;
  mimeType: string;
  fileName: string;
}

export interface FileVersionListInput {
  workspaceId: string;
  fileId: string;
}

export interface FileService {
  primaryWorkspace(): FileWorkspaceRecord | null;
  upload(input: FileUploadInput): Promise<FileUploadResult>;
  download(input: FileDownloadInput): Promise<FileDownloadResult>;
  listVersions(input: FileVersionListInput): Promise<FileVersionRecord[]>;
}

export interface FileServiceOptions {
  store: FileStore;
  blobRoot: string;
  now?: () => Date;
  generateId?: () => string;
}

function isUuid(value: string): boolean {
  return UUID_V4.test(value);
}

function checksumOf(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function conflictName(name: string): string {
  if (name.length + CONFLICT_SUFFIX.length <= limits.maxNameLength) {
    return `${name}${CONFLICT_SUFFIX}`;
  }

  return `${name.slice(0, limits.maxNameLength - CONFLICT_SUFFIX.length)}${CONFLICT_SUFFIX}`;
}

function validateName(name: string): string {
  try {
    return validateDisplayName(name);
  } catch (error) {
    throw new FileServiceError(
      "invalid_file_name",
      error instanceof Error ? error.message : "The file name is not valid."
    );
  }
}

function validateMimeType(mimeType: string): string {
  if (!limits.allowedMimeTypes.includes(mimeType)) {
    throw new FileServiceError(
      "unsupported_mime_type",
      "The file MIME type is not supported."
    );
  }

  return mimeType;
}

function validateSize(sizeBytes: number): number {
  if (!Number.isInteger(sizeBytes) || sizeBytes < 0) {
    throw new FileServiceError("file_too_large", "The file size is not valid.");
  }

  if (sizeBytes > limits.maxFileSizeBytes) {
    throw new FileServiceError(
      "file_too_large",
      `The file must be at most ${limits.maxFileSizeBytes} bytes.`
    );
  }

  return sizeBytes;
}

function requireEditor(role: Role): void {
  if (role !== "owner" && role !== "editor") {
    throw new FileServiceError("forbidden", "You are not allowed to upload files.");
  }
}

async function removeTemporaryFiles(directory: string): Promise<void> {
  let entries: import("node:fs").Dirent[];

  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      (error as { code?: unknown }).code === "ENOENT"
    ) {
      return;
    }

    throw error;
  }

  await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        await removeTemporaryFiles(entryPath);
        return;
      }

      if (entry.isFile() && entry.name.startsWith(".") && entry.name.endsWith(".tmp")) {
        await rm(entryPath, { force: true });
      }
    })
  );
}

export async function createFileService(
  options: FileServiceOptions
): Promise<FileService> {
  const { store, blobRoot } = options;
  const now = options.now ?? (() => new Date());
  const generateId = options.generateId ?? randomUUID;
  const blobStores = new Map<string, FileSystemBlobStore>();

  await removeTemporaryFiles(blobRoot);

  function workspaceOrThrow(workspaceId: string): FileWorkspaceRecord {
    if (!isUuid(workspaceId)) {
      throw new FileServiceError("workspace_not_found", "The workspace does not exist.");
    }

    const workspace = store.getWorkspace(workspaceId);

    if (workspace === null) {
      throw new FileServiceError("workspace_not_found", "The workspace does not exist.");
    }

    return workspace;
  }

  function blobsFor(workspaceId: string): FileSystemBlobStore {
    const cached = blobStores.get(workspaceId);

    if (cached !== undefined) {
      return cached;
    }

    const created = new FileSystemBlobStore({
      rootDir: path.join(blobRoot, "workspaces", workspaceId),
    });
    blobStores.set(workspaceId, created);
    return created;
  }

  function fileOrThrow(workspaceId: string, fileId: string): StoredFileRecord {
    assertFileId(fileId);
    const file = store.getFile(workspaceId, fileId);

    if (file === null) {
      throw new FileServiceError("not_found", "The file does not exist.");
    }

    return file;
  }

  function assertFileId(fileId: string): void {
    if (!isUuid(fileId)) {
      throw new FileServiceError("invalid_file_id", "The file identifier is not valid.");
    }
  }

  async function storeBlob(
    workspaceId: string,
    blobKey: string,
    mimeType: string,
    data: Uint8Array
  ): Promise<void> {
    await blobsFor(workspaceId).put(
      blobKey as BlobKey,
      new Blob([Uint8Array.from(data)], { type: mimeType })
    );
  }

  return {
    primaryWorkspace() {
      return store.primaryWorkspace();
    },
    async upload(input) {
      requireEditor(input.role);
      workspaceOrThrow(input.workspaceId);

      const name = validateName(input.name);
      const mimeType = validateMimeType(input.mimeType);
      const sizeBytes = validateSize(input.data.byteLength);

      if (input.folderId !== null) {
        if (!isUuid(input.folderId)) {
          throw new FileServiceError(
            "invalid_folder_id",
            "The folder identifier is not valid."
          );
        }

        if (!store.folderExists(input.workspaceId, input.folderId)) {
          throw new FileServiceError("folder_not_found", "The folder does not exist.");
        }
      }

      if (input.fileId === undefined && input.baseVersionId != null) {
        throw new FileServiceError(
          "invalid_base_version",
          "A new file cannot have a base version."
        );
      }

      if (input.fileId !== undefined) {
        assertFileId(input.fileId);

        if (!store.getFile(input.workspaceId, input.fileId)) {
          throw new FileServiceError("not_found", "The file does not exist.");
        }
      }

      const blobKey = generateId();

      if (!isUuid(blobKey)) {
        throw new FileServiceError(
          "storage_error",
          "The storage key could not be generated."
        );
      }

      const checksum = checksumOf(input.data);

      await storeBlob(input.workspaceId, blobKey, mimeType, input.data);

      try {
        return store.transaction(() => {
          const timestamp = now().toISOString();

          if (input.fileId === undefined) {
            const fileId = generateId();
            const versionId = generateId();

            if (!isUuid(fileId) || !isUuid(versionId)) {
              throw new FileServiceError(
                "storage_error",
                "The file identifier could not be generated."
              );
            }

            const file: StoredFileRecord = {
              id: fileId,
              workspaceId: input.workspaceId,
              folderId: input.folderId,
              name,
              mimeType,
              sizeBytes,
              blobKey,
              checksum,
              createdAt: timestamp,
              updatedAt: timestamp,
            };
            const version: FileVersionRecord = {
              id: versionId,
              fileId,
              workspaceId: input.workspaceId,
              versionNumber: 1,
              blobKey,
              name,
              mimeType,
              sizeBytes,
              checksum,
              uploadedBy: input.actorId,
              createdAt: timestamp,
            };

            store.insertFile(file);
            store.insertVersion(version);

            return { file, version, conflict: false, conflictOf: null };
          }

          const file = store.getFile(input.workspaceId, input.fileId);

          if (file === null) {
            throw new FileServiceError("not_found", "The file does not exist.");
          }

          if (input.baseVersionId === undefined || input.baseVersionId === null) {
            throw new FileServiceError(
              "base_version_required",
              "An upload must name the version it is based on."
            );
          }

          if (!isUuid(input.baseVersionId)) {
            throw new FileServiceError(
              "invalid_base_version",
              "The base version identifier is not valid."
            );
          }

          const baseVersion = store.getVersion(input.workspaceId, input.baseVersionId);

          if (baseVersion === null || baseVersion.fileId !== file.id) {
            throw new FileServiceError(
              "invalid_base_version",
              "The base version does not belong to this file."
            );
          }

          const latest = store.latestVersion(file.id);

          if (latest === null) {
            throw new FileServiceError(
              "storage_error",
              "The file has no stored versions."
            );
          }

          if (latest.id !== baseVersion.id) {
            const conflictFileId = generateId();
            const conflictVersionId = generateId();

            if (!isUuid(conflictFileId) || !isUuid(conflictVersionId)) {
              throw new FileServiceError(
                "storage_error",
                "The conflict copy identifier could not be generated."
              );
            }

            const conflictFile: StoredFileRecord = {
              id: conflictFileId,
              workspaceId: input.workspaceId,
              folderId: input.folderId ?? file.folderId,
              name: conflictName(name),
              mimeType,
              sizeBytes,
              blobKey,
              checksum,
              createdAt: timestamp,
              updatedAt: timestamp,
            };
            const conflictVersion: FileVersionRecord = {
              id: conflictVersionId,
              fileId: conflictFileId,
              workspaceId: input.workspaceId,
              versionNumber: 1,
              blobKey,
              name,
              mimeType,
              sizeBytes,
              checksum,
              uploadedBy: input.actorId,
              createdAt: timestamp,
            };

            store.insertFile(conflictFile);
            store.insertVersion(conflictVersion);

            return {
              file: conflictFile,
              version: conflictVersion,
              conflict: true,
              conflictOf: file.id,
            };
          }

          const version: FileVersionRecord = {
            id: generateId(),
            fileId: file.id,
            workspaceId: input.workspaceId,
            versionNumber: latest.versionNumber + 1,
            blobKey,
            name,
            mimeType,
            sizeBytes,
            checksum,
            uploadedBy: input.actorId,
            createdAt: timestamp,
          };

          if (!isUuid(version.id)) {
            throw new FileServiceError(
              "storage_error",
              "The file version identifier could not be generated."
            );
          }

          const updatedFile: StoredFileRecord = {
            ...file,
            folderId: input.folderId,
            name,
            mimeType,
            sizeBytes,
            blobKey,
            checksum,
            updatedAt: timestamp,
          };

          store.insertVersion(version);
          store.updateFile(updatedFile);

          return {
            file: updatedFile,
            version,
            conflict: false,
            conflictOf: null,
          };
        });
      } catch (error) {
        await blobsFor(input.workspaceId).delete(blobKey as BlobKey);
        throw error;
      }
    },
    async download(input) {
      workspaceOrThrow(input.workspaceId);
      const file = fileOrThrow(input.workspaceId, input.fileId);

      let version: FileVersionRecord | null;

      if (input.versionId !== undefined) {
        if (!isUuid(input.versionId)) {
          throw new FileServiceError(
            "invalid_version_id",
            "The version identifier is not valid."
          );
        }

        version = store.getVersion(input.workspaceId, input.versionId);

        if (version === null || version.fileId !== file.id) {
          throw new FileServiceError("not_found", "The file version does not exist.");
        }
      } else {
        version = store.latestVersion(file.id);
      }

      if (version === null) {
        throw new FileServiceError("storage_error", "The file has no stored versions.");
      }

      const blob = await blobsFor(input.workspaceId).get(version.blobKey as BlobKey);

      if (blob === null) {
        throw new FileServiceError("storage_error", "The file content is unavailable.");
      }

      return {
        file,
        version,
        data: new Uint8Array(await blob.arrayBuffer()),
        mimeType: version.mimeType,
        fileName: version.name,
      };
    },
    async listVersions(input) {
      workspaceOrThrow(input.workspaceId);
      fileOrThrow(input.workspaceId, input.fileId);
      return store.listVersions(input.workspaceId, input.fileId);
    },
  };
}
