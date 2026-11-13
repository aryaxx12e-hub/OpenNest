import { assertSameWorkspace } from "../checks";
import { ConstraintError, NotFoundError, ValidationError } from "../errors";
import type { StoredFile, Tag } from "../domain";
import type { BlobKey, FileId, FolderId, IsoDate, TagId, WorkspaceId } from "../ids";
import type {
  BlobStore,
  FileFilter,
  FileRepository,
  FolderRepository,
  ListOptions,
  Page,
  TagRepository,
  WorkspaceRepository,
} from "../ports";
import {
  assertSafeBlobKey,
  validateChecksum,
  validateDisplayName,
  validateUpload,
} from "../rules";
import type { Clock } from "./clock";
import { requireWorkspace } from "./require";

export interface FileService {
  create(input: {
    workspaceId: WorkspaceId;
    folderId: FolderId | null;
    name: string;
    mimeType: string | null;
    sizeBytes: number;
    blobKey: string;
    checksum: string | null;
  }): Promise<StoredFile>;
  upload(input: {
    workspaceId: WorkspaceId;
    folderId: FolderId | null;
    name: string;
    mimeType: string | null;
    data: Uint8Array;
  }): Promise<StoredFile>;
  update(
    id: FileId,
    patch: { name?: string; folderId?: FolderId | null }
  ): Promise<StoredFile>;
  get(id: FileId): Promise<StoredFile | null>;
  list(
    workspaceId: WorkspaceId,
    filter: FileFilter,
    options?: ListOptions
  ): Promise<Page<StoredFile>>;
  setTags(id: FileId, tagIds: TagId[]): Promise<void>;
  tags(id: FileId): Promise<Tag[]>;
  delete(id: FileId): Promise<void>;
}

export interface FileDeps {
  files: FileRepository;
  folders: FolderRepository;
  workspaces: WorkspaceRepository;
  blobs: BlobStore;
  tags?: TagRepository;
  clock: Clock;
  hash: (data: Uint8Array) => Promise<string>;
  generateBlobKey: () => string;
}

export function createFileService(deps: FileDeps): FileService {
  const { files, folders, workspaces, blobs, tags, clock, hash, generateBlobKey } = deps;

  async function checkRefs(
    workspaceId: WorkspaceId,
    folderId: FolderId | null,
    tagIds?: TagId[]
  ): Promise<void> {
    await requireWorkspace(workspaces, workspaceId);
    await assertSameWorkspace(
      { folders, tags: tags ?? emptyTags },
      {
        workspaceId,
        folderId,
        ...(tagIds === undefined ? {} : { tagIds }),
      }
    );
  }

  async function createRow(input: {
    workspaceId: WorkspaceId;
    folderId: FolderId | null;
    name: string;
    mimeType: string | null;
    sizeBytes: number;
    blobKey: string;
    checksum: string | null;
  }): Promise<StoredFile> {
    const name = validateDisplayName(input.name);
    validateUpload({
      name,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
    });
    assertSafeBlobKey(input.blobKey);
    await checkRefs(input.workspaceId, input.folderId);

    const checksum = validateChecksum(input.checksum);

    return files.create({
      workspaceId: input.workspaceId,
      folderId: input.folderId,
      name,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      blobKey: input.blobKey as BlobKey,
      checksum,
      at: clock(),
    });
  }

  return {
    create(input) {
      return createRow(input);
    },
    async upload(input) {
      const name = validateDisplayName(input.name);
      validateUpload({
        name,
        mimeType: input.mimeType,
        sizeBytes: input.data.byteLength,
      });
      await checkRefs(input.workspaceId, input.folderId);

      const blobKey = generateBlobKey();
      assertSafeBlobKey(blobKey);

      const checksum = (await hash(input.data)).toLowerCase();
      await blobs.put(blobKey as BlobKey, input.data);

      try {
        return await files.create({
          workspaceId: input.workspaceId,
          folderId: input.folderId,
          name,
          mimeType: input.mimeType,
          sizeBytes: input.data.byteLength,
          blobKey: blobKey as BlobKey,
          checksum,
          at: clock(),
        });
      } catch (error) {
        await blobs.delete(blobKey as BlobKey);
        throw error;
      }
    },
    async update(id, patch) {
      const file = await files.get(id);

      if (file === null) {
        throw new NotFoundError("File does not exist.");
      }

      const next: { name?: string; folderId?: FolderId | null; at?: IsoDate } = {
        at: clock(),
      };

      if (patch.name !== undefined) {
        next.name = validateDisplayName(patch.name);
      }

      if (patch.folderId !== undefined) {
        await checkRefs(file.workspaceId, patch.folderId);
        next.folderId = patch.folderId;
      }

      return files.update(id, next);
    },
    get(id) {
      return files.get(id);
    },
    list(workspaceId, filter, options) {
      return files.list(workspaceId, filter, options);
    },
    async setTags(id, tagIds) {
      const file = await files.get(id);

      if (file === null) {
        throw new NotFoundError("File does not exist.");
      }

      if (tags === undefined) {
        throw new ConstraintError(
          "This file service was created without a tag repository.",
          "missing_reference"
        );
      }

      await checkRefs(file.workspaceId, file.folderId, [...new Set(tagIds)]);
      await files.setTags(id, [...new Set(tagIds)]);
    },
    tags(id) {
      return files.tags(id);
    },
    async delete(id) {
      const file = await files.get(id);

      if (file === null) {
        throw new NotFoundError("File does not exist.");
      }

      await files.delete(id);
    },
  };
}

const emptyTags: TagRepository = {
  async create() {
    throw new ValidationError("No tag repository is configured.");
  },
  async get() {
    return null;
  },
  async update() {
    throw new ValidationError("No tag repository is configured.");
  },
  async delete() {
    throw new ValidationError("No tag repository is configured.");
  },
  async list() {
    return { items: [], nextCursor: null, total: 0 };
  },
  async findByName() {
    return null;
  },
};
