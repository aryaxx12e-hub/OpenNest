import type { IsoDate, NoteId, WorkspaceId } from "../ids";

export interface CollaborationSnapshot {
  noteId: NoteId;
  workspaceId: WorkspaceId;
  content: string;
  updatedAt: IsoDate;
}

export interface CollaborationSnapshotState {
  content: string;
  updatedAt: IsoDate;
}

export interface CollaborationSnapshotMetadata {
  workspaceId: WorkspaceId;
  at: IsoDate;
}

export interface CollaborationStore {
  loadSnapshot(noteId: NoteId): Promise<CollaborationSnapshot | null>;
  writeSnapshot(
    noteId: NoteId,
    state: CollaborationSnapshotState,
    metadata: CollaborationSnapshotMetadata
  ): Promise<void>;
}
