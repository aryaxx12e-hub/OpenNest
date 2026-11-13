import type {
  BlobKey,
  FileId,
  FolderId,
  IsoDate,
  NoteId,
  TagId,
  WorkspaceId,
} from "./ids";

export interface Workspace {
  id: WorkspaceId;
  name: string;
  createdAt: IsoDate;
  updatedAt: IsoDate;
}

export interface Folder {
  id: FolderId;
  workspaceId: WorkspaceId;
  parentId: FolderId | null;
  name: string;
  createdAt: IsoDate;
  updatedAt: IsoDate;
}

export interface StoredFile {
  id: FileId;
  workspaceId: WorkspaceId;
  folderId: FolderId | null;
  name: string;
  mimeType: string | null;
  sizeBytes: number;
  blobKey: BlobKey;
  checksum: string | null;
  createdAt: IsoDate;
  updatedAt: IsoDate;
}

export interface Note {
  id: NoteId;
  workspaceId: WorkspaceId;
  folderId: FolderId | null;
  title: string;
  content: string;
  pinned: boolean;
  createdAt: IsoDate;
  updatedAt: IsoDate;
}

export interface Tag {
  id: TagId;
  workspaceId: WorkspaceId;
  name: string;
  color: string | null;
  createdAt: IsoDate;
}

export interface FileTag {
  fileId: FileId;
  tagId: TagId;
}

export interface NoteTag {
  noteId: NoteId;
  tagId: TagId;
}

export interface NoteLink {
  sourceNoteId: NoteId;
  targetNoteId: NoteId;
}
