import type {
  SyncConflictRow,
  SyncDeviceRow,
  SyncEntityType,
  SyncFieldMetaRow,
  SyncMetaRow,
  SyncOutboxRow,
  SyncTombstoneRow,
  WorkspaceSyncStateRow,
} from "@opennest/sync";
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

export const SYNC_TABLE_NAMES = [
  "sync_meta",
  "sync_field_meta",
  "sync_outbox",
  "workspace_sync_state",
  "sync_tombstone",
  "sync_conflict",
  "sync_devices",
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
  declare sync_meta: Table<SyncMetaRow, [string, SyncEntityType, string]>;
  declare sync_field_meta: Table<
    SyncFieldMetaRow,
    [string, SyncEntityType, string, string]
  >;
  declare sync_outbox: Table<SyncOutboxRow, string>;
  declare workspace_sync_state: Table<WorkspaceSyncStateRow, [string, string]>;
  declare sync_tombstone: Table<SyncTombstoneRow, [string, SyncEntityType, string]>;
  declare sync_conflict: Table<SyncConflictRow, string>;
  declare sync_devices: Table<SyncDeviceRow, [string, string]>;

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

    // Version 3 adds the sync sidecars. The upgrade writes the "legacy"
    // migration marker only. init() replaces it with the installation device.
    this.version(3)
      .stores({
        sync_meta: "[workspaceId+entityType+entityId], [workspaceId+workspaceRevision]",
        sync_field_meta:
          "[workspaceId+entityType+entityId+fieldPath], " +
          "[workspaceId+entityType+entityId]",
        sync_outbox:
          "opId, &[workspaceId+deviceId+localSequence], " +
          "[workspaceId+deviceId+state+localSequence]",
        workspace_sync_state: "[workspaceId+deviceId]",
        sync_tombstone:
          "[workspaceId+entityType+entityId], " +
          "[workspaceId+tombstoneWorkspaceRevision]",
        sync_conflict: "conflictId, [workspaceId+entityId+state]",
        sync_devices: "[workspaceId+deviceId], [workspaceId+state]",
      })
      .upgrade(async (transaction) => {
        const workspaces = (await transaction
          .table("workspaces")
          .toArray()) as WorkspaceRow[];
        const folders = (await transaction.table("folders").toArray()) as FolderRow[];
        const files = (await transaction.table("files").toArray()) as FileRow[];
        const notes = (await transaction.table("notes").toArray()) as NoteRow[];
        const tags = (await transaction.table("tags").toArray()) as TagRow[];

        const meta: SyncMetaRow[] = [];
        for (const workspace of workspaces) {
          meta.push({
            workspaceId: workspace.id,
            entityType: "workspace",
            entityId: workspace.id,
            entityRevision: 1,
            workspaceRevision: 0,
            originDeviceId: "legacy",
            updatedAt: workspace.updatedAt,
            deletedAt: null,
            contentHash: null,
          });
        }
        for (const folder of folders) {
          meta.push({
            workspaceId: folder.workspaceId,
            entityType: "folder",
            entityId: folder.id,
            entityRevision: 1,
            workspaceRevision: 0,
            originDeviceId: "legacy",
            updatedAt: folder.updatedAt,
            deletedAt: null,
            contentHash: null,
          });
        }
        for (const file of files) {
          meta.push({
            workspaceId: file.workspaceId,
            entityType: "file",
            entityId: file.id,
            entityRevision: 1,
            workspaceRevision: 0,
            originDeviceId: "legacy",
            updatedAt: file.updatedAt,
            deletedAt: null,
            contentHash: file.checksum,
          });
        }
        for (const note of notes) {
          meta.push({
            workspaceId: note.workspaceId,
            entityType: "note",
            entityId: note.id,
            entityRevision: 1,
            workspaceRevision: 0,
            originDeviceId: "legacy",
            updatedAt: note.updatedAt,
            deletedAt: null,
            contentHash: null,
          });
        }
        for (const tag of tags) {
          meta.push({
            workspaceId: tag.workspaceId,
            entityType: "tag",
            entityId: tag.id,
            entityRevision: 1,
            workspaceRevision: 0,
            originDeviceId: "legacy",
            updatedAt: tag.createdAt,
            deletedAt: null,
            contentHash: null,
          });
        }
        if (meta.length > 0) {
          await transaction.table("sync_meta").bulkAdd(meta);
        }

        const states: WorkspaceSyncStateRow[] = workspaces.map((workspace) => ({
          workspaceId: workspace.id,
          deviceId: "legacy",
          remoteWorkspaceId: null,
          lastServerCursor: null,
          lastLocalWorkspaceRevision: 0,
          lastLocalSequence: 0,
          tombstoneFloor: 0,
          lastFullResyncAt: null,
        }));
        if (states.length > 0) {
          await transaction.table("workspace_sync_state").bulkAdd(states);
        }
      });

    // Version 4 adds the per-workspace/device local sequence high-water mark.
    // The outbox remains append-only; this column keeps the next sequence
    // monotonic even after acknowledged rows are pruned or the outbox is reset.
    this.version(4).upgrade(async (transaction) => {
      const outbox = (await transaction
        .table("sync_outbox")
        .toArray()) as SyncOutboxRow[];
      const highest = new Map<string, number>();
      for (const row of outbox) {
        const stateKey = `${row.workspaceId}\u0000${row.deviceId}`;
        highest.set(stateKey, Math.max(highest.get(stateKey) ?? 0, row.localSequence));
      }

      const states = (await transaction
        .table("workspace_sync_state")
        .toArray()) as WorkspaceSyncStateRow[];
      for (const state of states) {
        const stateKey = `${state.workspaceId}\u0000${state.deviceId}`;
        await transaction.table("workspace_sync_state").put({
          ...state,
          lastLocalSequence: Math.max(
            state.lastLocalSequence ?? 0,
            highest.get(stateKey) ?? 0
          ),
        });
      }
    });
  }
}
