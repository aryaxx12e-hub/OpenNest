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
import { eq } from "drizzle-orm";

import type { SqliteDatabase } from "./db";
import { laterOf } from "./repo-helpers";
import { notes as notesTable } from "./schema";

const SNAPSHOT_POLICY: SyncPolicy = {
  ...DEFAULT_SYNC_POLICY,
  outbox: {
    ...DEFAULT_SYNC_POLICY.outbox,
    enabled: false,
  },
};

export interface SqliteCollaborationStoreOptions {
  getDb: () => SqliteDatabase;
  sync: SyncStore;
  atomic: <T>(work: () => Promise<T>) => Promise<T>;
}

export function createSqliteCollaborationStore(
  options: SqliteCollaborationStoreOptions
): CollaborationStore {
  return {
    async loadSnapshot(noteId) {
      const [row] = await options
        .getDb()
        .select()
        .from(notesTable)
        .where(eq(notesTable.id, noteId))
        .limit(1);

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
      await options.atomic(async () => {
        const db = options.getDb();
        const [row] = await db
          .select()
          .from(notesTable)
          .where(eq(notesTable.id, noteId))
          .limit(1);

        if (row === undefined || row.workspaceId !== metadata.workspaceId) {
          throw new NotFoundError("Note does not exist.");
        }

        const at = laterOf(state.updatedAt, metadata.at);
        const updatedAt = laterOf(at, row.updatedAt as IsoDate);

        await db
          .update(notesTable)
          .set({ content: state.content, updatedAt })
          .where(eq(notesTable.id, noteId));

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
          await recordPreparedSyncChanges(options.sync, {
            changes: [change],
            policy,
          });
        }
      });
    },
  };
}
