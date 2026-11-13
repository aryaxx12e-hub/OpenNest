import type {
  BlobKey,
  FileId,
  FolderId,
  IsoDate,
  NoteId,
  TagId,
  WorkspaceId,
} from "./ids";
import type {
  FileTag,
  Folder,
  Note,
  NoteLink,
  NoteTag,
  StoredFile,
  Tag,
  Workspace,
} from "./domain";

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
  total: number;
}

export type SortField = "name" | "createdAt" | "updatedAt";

export interface ListOptions {
  limit?: number;
  cursor?: string | null;
  sort?: SortField;
  direction?: "asc" | "desc";
}

export interface FileFilter {
  folderId?: FolderId | null;
  tagIds?: TagId[];
  mimeTypes?: string[];
  text?: string;
}

export interface NoteFilter {
  folderId?: FolderId | null;
  tagIds?: TagId[];
  pinned?: boolean;
  text?: string;
}

export interface WorkspaceRepository {
  get(id: WorkspaceId): Promise<Workspace | null>;
  list(): Promise<Workspace[]>;
  create(input: { name: string; at?: IsoDate }): Promise<Workspace>;
  update(id: WorkspaceId, patch: { name: string; at?: IsoDate }): Promise<Workspace>;
  delete(id: WorkspaceId): Promise<void>;
  ensureWorkspace(input?: { name?: string; at?: IsoDate }): Promise<Workspace>;
}

export interface FolderRepository {
  create(input: {
    workspaceId: WorkspaceId;
    parentId: FolderId | null;
    name: string;
    at?: IsoDate;
  }): Promise<Folder>;
  get(id: FolderId): Promise<Folder | null>;
  update(
    id: FolderId,
    patch: { name?: string; parentId?: FolderId | null; at?: IsoDate }
  ): Promise<Folder>;
  delete(id: FolderId): Promise<void>;
  list(workspaceId: WorkspaceId, options?: ListOptions): Promise<Page<Folder>>;
  listChildren(workspaceId: WorkspaceId, parentId: FolderId | null): Promise<Folder[]>;
  ancestors(id: FolderId): Promise<Folder[]>;
  descendants(id: FolderId): Promise<Folder[]>;
}

export interface FileRepository {
  create(input: {
    workspaceId: WorkspaceId;
    folderId: FolderId | null;
    name: string;
    mimeType: string | null;
    sizeBytes: number;
    blobKey: BlobKey;
    checksum: string | null;
    at?: IsoDate;
  }): Promise<StoredFile>;
  get(id: FileId): Promise<StoredFile | null>;
  update(
    id: FileId,
    patch: { name?: string; folderId?: FolderId | null; at?: IsoDate }
  ): Promise<StoredFile>;
  delete(id: FileId): Promise<void>;
  list(
    workspaceId: WorkspaceId,
    filter: FileFilter,
    options?: ListOptions
  ): Promise<Page<StoredFile>>;
  setTags(id: FileId, tagIds: TagId[]): Promise<void>;
  tags(id: FileId): Promise<Tag[]>;
}

export interface NoteRepository {
  create(input: {
    workspaceId: WorkspaceId;
    folderId: FolderId | null;
    title: string;
    content?: string;
    pinned?: boolean;
    at?: IsoDate;
  }): Promise<Note>;
  get(id: NoteId): Promise<Note | null>;
  update(
    id: NoteId,
    patch: {
      title?: string;
      content?: string;
      folderId?: FolderId | null;
      pinned?: boolean;
      at?: IsoDate;
    }
  ): Promise<Note>;
  delete(id: NoteId): Promise<void>;
  list(
    workspaceId: WorkspaceId,
    filter: NoteFilter,
    options?: ListOptions
  ): Promise<Page<Note>>;
  setTags(id: NoteId, tagIds: TagId[]): Promise<void>;
  tags(id: NoteId): Promise<Tag[]>;
  setLinks(id: NoteId, targetIds: NoteId[]): Promise<void>;
  links(id: NoteId): Promise<NoteLink[]>;
}

export interface TagRepository {
  create(input: {
    workspaceId: WorkspaceId;
    name: string;
    color?: string | null;
    at?: IsoDate;
  }): Promise<Tag>;
  get(id: TagId): Promise<Tag | null>;
  update(
    id: TagId,
    patch: { name?: string; color?: string | null; at?: IsoDate }
  ): Promise<Tag>;
  delete(id: TagId): Promise<void>;
  list(workspaceId: WorkspaceId, options?: ListOptions): Promise<Page<Tag>>;
  findByName(workspaceId: WorkspaceId, key: string): Promise<Tag | null>;
}

export interface SearchQuery {
  workspaceId: WorkspaceId;
  text: string;
  kinds?: Array<"file" | "note">;
  folderId?: FolderId | null;
  tagIds?: TagId[];
  limit?: number;
  offset?: number;
}

export interface SearchHit {
  kind: "file" | "note";
  id: string;
  title: string;
  snippet: string;
  score: number;
}

export interface SearchRepository {
  search(query: SearchQuery): Promise<SearchHit[]>;
  reindexAll(workspaceId: WorkspaceId): Promise<void>;
}

export interface BlobStore {
  put(key: BlobKey, data: Blob | Uint8Array): Promise<void>;
  get(key: BlobKey): Promise<Blob | null>;
  delete(key: BlobKey): Promise<void>;
  has(key: BlobKey): Promise<boolean>;
  usage(): Promise<{ bytes: number; items: number }>;
  purgeOrphans(knownKeys: BlobKey[]): Promise<number>;
}

export interface BackupSnapshot {
  snapshotVersion: 1;
  schemaVersion: number;
  kind: "dexie" | "sqlite";
  createdAt: IsoDate;
  workspace: Workspace;
  folders: Folder[];
  files: StoredFile[];
  notes: Note[];
  tags: Tag[];
  fileTags: FileTag[];
  noteTags: NoteTag[];
  noteLinks: NoteLink[];
  blobs: Array<{ key: BlobKey; mimeType: string; data: Uint8Array }>;
}

export type TransactionRunner = <T>(
  work: (repos: Repositories) => Promise<T>
) => Promise<T>;

export interface Repositories {
  workspaces: WorkspaceRepository;
  folders: FolderRepository;
  files: FileRepository;
  notes: NoteRepository;
  tags: TagRepository;
  search: SearchRepository;
  blobs: BlobStore;
  transaction: TransactionRunner;
}

export interface StorageAdapter extends Repositories {
  readonly kind: "dexie" | "sqlite";
  readonly schemaVersion: number;
  init(): Promise<void>;
  close(): Promise<void>;
  reset(): Promise<void>;
  restore(snapshot: BackupSnapshot): Promise<void>;
}

export interface SqliteStorageConfig {
  databaseFile: string;
  blobRoot: string;
}

export interface DexieStorageConfig {
  databaseName: string;
}
