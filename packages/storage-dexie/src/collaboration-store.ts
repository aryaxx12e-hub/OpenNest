import {
  NotFoundError,
  type CollaborationSnapshotMetadata,
  type CollaborationSnapshotState,
  type CollaborationStore,
  type IsoDate,
  type NoteId,
  type WorkspaceId,
} from "@opennest/core";
import {
  DEFAULT_SYNC_POLICY,
  prepareSyncChanges,
  recordPreparedSyncChanges,
  type SyncPolicy,
  type SyncStore,
} from "@opennest/sync";

import type { OpenNestDexie } from "./schema";

const SNAPSHOT_POLICY: SyncPolicy = {
  ...DEFAULT_SYNC_POLICY,
  outbox: {
    ...DEFAULT_SYNC_POLICY.outbox,
    enabled: false,
  },
};

function laterOf(left: IsoDate, right: IsoDate): IsoDate {
  return left > right ? left : right;
}

export interface DexieCollaborationStoreOptions {
  db: OpenNestDexie;
  sync: SyncStore;
}

export function createDexieCollaborationStore(
  options: DexieCollaborationStoreOptions
): CollaborationStore {
  return {
    async loadSnapshot(noteId) {
      const row = await options.db.notes.get(noteId);

      if (row === undefined) {
        return null;
      }

      return {
        noteId: row.id as NoteId,
        workspaceId: row.workspaceId as WorkspaceId,
        content: row.content,
        updatedAt: row.updatedAt as IsoDate,
      };
    },

    async writeSnapshot(
      noteId: NoteId,
      state: CollaborationSnapshotState,
      metadata: CollaborationSnapshotMetadata
    ) {
      const { db, sync } = options;

      await db.transaction(
        "rw",
        [
          db.notes,
          db.sync_meta,
          db.sync_field_meta,
          db.sync_outbox,
          db.workspace_sync_state,
          db.sync_tombstone,
          db.sync_devices,
        ],
        async () => {
          const row = await db.notes.get(noteId);

          if (row === undefined || row.workspaceId !== metadata.workspaceId) {
            throw new NotFoundError("Note does not exist.");
          }

          const at = laterOf(state.updatedAt, metadata.at);
          const updatedAt = laterOf(at, row.updatedAt as IsoDate);

          await db.notes.update(noteId, {
            content: state.content,
            updatedAt,
          });

          const policy = SNAPSHOT_POLICY;
          const [change] = await prepareSyncChanges({
            changes: [
              {
                workspaceId: metadata.workspaceId,
                entityType: "note",
                entityId: noteId,
                operation: "update",
                fieldPatches: { content: state.content },
                at,
                contentHash: null,
              },
            ],
            policy,
          });

          if (change !== undefined) {
            await recordPreparedSyncChanges(sync, {
              changes: [change],
              policy,
            });
          }
        }
      );
    },
  };
}
