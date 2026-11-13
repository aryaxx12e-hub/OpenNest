import type { Table } from "dexie";
import Dexie from "dexie";

export interface WorkspaceRow {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface FolderRow {
  id: string;
  workspaceId: string;
  parentId: string | null;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface FileRow {
  id: string;
  workspaceId: string;
  folderId: string | null;
  name: string;
  mimeType: string | null;
  sizeBytes: number;
  blobKey: string;
  checksum: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NoteRow {
  id: string;
  workspaceId: string;
  folderId: string | null;
  title: string;
  content: string;
  pinned: 0 | 1;
  createdAt: string;
  updatedAt: string;
}

export interface TagRow {
  id: string;
  workspaceId: string;
  name: string;
  color: string | null;
  createdAt: string;
}

export interface FileTagRow {
  fileId: string;
  tagId: string;
}

export interface NoteTagRow {
  noteId: string;
  tagId: string;
}

export interface NoteLinkRow {
  sourceNoteId: string;
  targetNoteId: string;
}

export interface BlobRow {
  key: string;
  type: string;
  size: number;
  data: Uint8Array;
}

export interface StorageOptions {
  indexedDB?: IDBFactory;
  IDBKeyRange?: typeof IDBKeyRange;
}

export const TABLE_NAMES = [
  "workspaces",
  "folders",
  "files",
  "notes",
  "tags",
  "fileTags",
  "noteTags",
  "noteLinks",
  "blobs",
] as const;

export class OpenNestDexie extends Dexie {
  declare workspaces: Table<WorkspaceRow, string>;
  declare folders: Table<FolderRow, string>;
  declare files: Table<FileRow, string>;
  declare notes: Table<NoteRow, string>;
  declare tags: Table<TagRow, string>;
  declare fileTags: Table<FileTagRow, [string, string]>;
  declare noteTags: Table<NoteTagRow, [string, string]>;
  declare noteLinks: Table<NoteLinkRow, [string, string]>;
  declare blobs: Table<BlobRow, string>;

  constructor(databaseName: string, options: StorageOptions = {}) {
    super(databaseName, {
      ...(options.indexedDB === undefined ? {} : { indexedDB: options.indexedDB }),
      ...(options.IDBKeyRange === undefined ? {} : { IDBKeyRange: options.IDBKeyRange }),
    });

    // Version 1 (primary keys only) shipped first. Adding an index to a
    // released version is not a migration: existing databases keep the old
    // index set. Version 2 adds every sort index in one step and stores the
    // same rows, so data and backups are unchanged. Never edit version 1.
    this.version(1).stores({
      workspaces: "id",
      folders: "id",
      files: "id",
      notes: "id",
      tags: "id",
      fileTags: "[fileId+tagId]",
      noteTags: "[noteId+tagId]",
      noteLinks: "[sourceNoteId+targetNoteId]",
      blobs: "key",
    });

    this.version(2).stores({
      workspaces: "id",
      folders:
        "id, workspaceId, parentId, [workspaceId+parentId], " +
        "[workspaceId+name+id], [workspaceId+createdAt+id], [workspaceId+updatedAt+id]",
      files:
        "id, workspaceId, folderId, [workspaceId+folderId], " +
        "[workspaceId+name+id], [workspaceId+createdAt+id], [workspaceId+updatedAt+id]",
      notes:
        "id, workspaceId, folderId, [workspaceId+folderId], pinned, " +
        "[workspaceId+title+id], [workspaceId+createdAt+id], [workspaceId+updatedAt+id]",
      tags: "id, workspaceId, &[workspaceId+name], [workspaceId+createdAt+id]",
      fileTags: "[fileId+tagId], fileId, tagId",
      noteTags: "[noteId+tagId], noteId, tagId",
      noteLinks: "[sourceNoteId+targetNoteId], sourceNoteId, targetNoteId",
      blobs: "key",
    });
  }
}
