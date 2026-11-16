import { generateId } from "@opennest/core";
import {
  SyncError,
  type SyncConflictResolution,
  type SyncConflictRow,
  type SyncConflictState,
  type SyncDeviceRow,
  type SyncDeviceState,
  type SyncEntityType,
  type SyncFieldMetaRow,
  type SyncMetaRow,
  type SyncOperation,
  type SyncOutboxRow,
  type SyncOutboxState,
  type SyncStore,
  type SyncTombstoneRow,
  type SyncTombstoneState,
  type WorkspaceSyncStateRow,
} from "@opennest/sync";
import { and, eq, isNotNull } from "drizzle-orm";

import type { SqliteDatabase } from "./db";
import {
  syncConflict as syncConflictTable,
  syncDevices as syncDevicesTable,
  syncFieldMeta as syncFieldMetaTable,
  syncMeta as syncMetaTable,
  syncOutbox as syncOutboxTable,
  syncTombstone as syncTombstoneTable,
  workspaceSyncState as workspaceSyncStateTable,
} from "./schema";

type MetaSelect = typeof syncMetaTable.$inferSelect;
type FieldMetaSelect = typeof syncFieldMetaTable.$inferSelect;
type OutboxSelect = typeof syncOutboxTable.$inferSelect;
type StateSelect = typeof workspaceSyncStateTable.$inferSelect;
type TombstoneSelect = typeof syncTombstoneTable.$inferSelect;
type ConflictSelect = typeof syncConflictTable.$inferSelect;
type DeviceSelect = typeof syncDevicesTable.$inferSelect;

function toMeta(row: MetaSelect): SyncMetaRow {
  return { ...row, entityType: row.entityType as SyncEntityType };
}

function toFieldMeta(row: FieldMetaSelect): SyncFieldMetaRow {
  return { ...row, entityType: row.entityType as SyncEntityType };
}

function toOutbox(row: OutboxSelect): SyncOutboxRow {
  return {
    ...row,
    entityType: row.entityType as SyncEntityType,
    operation: row.operation as SyncOperation,
    fieldPatches: JSON.parse(row.fieldPatches) as Record<string, unknown>,
    state: row.state as SyncOutboxState,
  };
}

function toState(row: StateSelect): WorkspaceSyncStateRow {
  return { ...row };
}

function toTombstone(row: TombstoneSelect): SyncTombstoneRow {
  return {
    ...row,
    entityType: row.entityType as SyncEntityType,
    state: row.state as SyncTombstoneState,
  };
}

function toConflict(row: ConflictSelect): SyncConflictRow {
  return {
    ...row,
    entityType: row.entityType as SyncEntityType,
    localValue: JSON.parse(row.localValue) as unknown,
    remoteValue: JSON.parse(row.remoteValue) as unknown,
    state: row.state as SyncConflictState,
    resolution: row.resolution as SyncConflictResolution | null,
  };
}

function toDevice(row: DeviceSelect): SyncDeviceRow {
  return { ...row, state: row.state as SyncDeviceState };
}

export function createSqliteSyncStore(getDb: () => SqliteDatabase): SyncStore {
  return {
    async getOrCreateDevice(workspaceId, at) {
      const db = getDb();
      const devices = await db.select().from(syncDevicesTable);
      const existing = devices.find((row) => row.workspaceId === workspaceId);
      if (existing !== undefined) {
        return toDevice(existing);
      }

      const deviceId = devices[0]?.deviceId ?? generateId();
      const row: SyncDeviceRow = {
        workspaceId,
        deviceId,
        registeredAt: at,
        lastSeenAt: at,
        lastAckedTombstoneWorkspaceRevision: 0,
        state: "active",
        publicKey: null,
      };
      await db.insert(syncDevicesTable).values(row).onConflictDoNothing();
      return row;
    },

    async getDevice(workspaceId, deviceId) {
      const [row] = await getDb()
        .select()
        .from(syncDevicesTable)
        .where(
          and(
            eq(syncDevicesTable.workspaceId, workspaceId),
            eq(syncDevicesTable.deviceId, deviceId)
          )
        );
      return row === undefined ? null : toDevice(row);
    },

    async listDevices(workspaceId) {
      const rows = await getDb()
        .select()
        .from(syncDevicesTable)
        .where(eq(syncDevicesTable.workspaceId, workspaceId));
      return rows.map(toDevice);
    },

    async getWorkspaceState(workspaceId, deviceId) {
      const [row] = await getDb()
        .select()
        .from(workspaceSyncStateTable)
        .where(
          and(
            eq(workspaceSyncStateTable.workspaceId, workspaceId),
            eq(workspaceSyncStateTable.deviceId, deviceId)
          )
        );
      return row === undefined ? null : toState(row);
    },

    async getOrCreateWorkspaceState(workspaceId, deviceId, at) {
      const db = getDb();
      const [existing] = await db
        .select()
        .from(workspaceSyncStateTable)
        .where(
          and(
            eq(workspaceSyncStateTable.workspaceId, workspaceId),
            eq(workspaceSyncStateTable.deviceId, deviceId)
          )
        );
      if (existing !== undefined) {
        return toState(existing);
      }

      const row = {
        workspaceId,
        deviceId,
        remoteWorkspaceId: null,
        lastServerCursor: null,
        lastLocalWorkspaceRevision: 0,
        lastLocalSequence: 0,
        tombstoneFloor: 0,
        lastFullResyncAt: at,
      };
      await db.insert(workspaceSyncStateTable).values(row).onConflictDoNothing();
      return row;
    },

    async putWorkspaceState(row) {
      await getDb()
        .insert(workspaceSyncStateTable)
        .values(row)
        .onConflictDoUpdate({
          target: [workspaceSyncStateTable.workspaceId, workspaceSyncStateTable.deviceId],
          set: {
            remoteWorkspaceId: row.remoteWorkspaceId,
            lastServerCursor: row.lastServerCursor,
            lastLocalWorkspaceRevision: row.lastLocalWorkspaceRevision,
            lastLocalSequence: row.lastLocalSequence,
            tombstoneFloor: row.tombstoneFloor,
            lastFullResyncAt: row.lastFullResyncAt,
          },
        });
    },

    async hasRemoteTarget(workspaceId) {
      const rows = await getDb()
        .select({ workspaceId: workspaceSyncStateTable.workspaceId })
        .from(workspaceSyncStateTable)
        .where(
          and(
            eq(workspaceSyncStateTable.workspaceId, workspaceId),
            isNotNull(workspaceSyncStateTable.remoteWorkspaceId)
          )
        )
        .limit(1);
      return rows.length > 0;
    },

    async getEntityMeta(workspaceId, entityType, entityId) {
      const [row] = await getDb()
        .select()
        .from(syncMetaTable)
        .where(
          and(
            eq(syncMetaTable.workspaceId, workspaceId),
            eq(syncMetaTable.entityType, entityType),
            eq(syncMetaTable.entityId, entityId)
          )
        );
      return row === undefined ? null : toMeta(row);
    },

    async listEntityMeta(workspaceId) {
      const rows = await getDb()
        .select()
        .from(syncMetaTable)
        .where(eq(syncMetaTable.workspaceId, workspaceId));
      return rows.map(toMeta);
    },

    async putEntityMeta(row) {
      await getDb()
        .insert(syncMetaTable)
        .values(row)
        .onConflictDoUpdate({
          target: [
            syncMetaTable.workspaceId,
            syncMetaTable.entityType,
            syncMetaTable.entityId,
          ],
          set: {
            entityRevision: row.entityRevision,
            workspaceRevision: row.workspaceRevision,
            originDeviceId: row.originDeviceId,
            updatedAt: row.updatedAt,
            deletedAt: row.deletedAt,
            contentHash: row.contentHash,
          },
        });
    },

    async getFieldMeta(workspaceId, entityType, entityId, fieldPath) {
      const [row] = await getDb()
        .select()
        .from(syncFieldMetaTable)
        .where(
          and(
            eq(syncFieldMetaTable.workspaceId, workspaceId),
            eq(syncFieldMetaTable.entityType, entityType),
            eq(syncFieldMetaTable.entityId, entityId),
            eq(syncFieldMetaTable.fieldPath, fieldPath)
          )
        );
      return row === undefined ? null : toFieldMeta(row);
    },

    async listFieldMeta(workspaceId) {
      const rows = await getDb()
        .select()
        .from(syncFieldMetaTable)
        .where(eq(syncFieldMetaTable.workspaceId, workspaceId));
      return rows.map(toFieldMeta);
    },

    async putFieldMeta(row) {
      await getDb()
        .insert(syncFieldMetaTable)
        .values(row)
        .onConflictDoUpdate({
          target: [
            syncFieldMetaTable.workspaceId,
            syncFieldMetaTable.entityType,
            syncFieldMetaTable.entityId,
            syncFieldMetaTable.fieldPath,
          ],
          set: {
            fieldRevision: row.fieldRevision,
            workspaceRevision: row.workspaceRevision,
            originDeviceId: row.originDeviceId,
            updatedAt: row.updatedAt,
            deletedAt: row.deletedAt,
          },
        });
    },

    async appendOutbox(row) {
      const db = getDb();
      try {
        await db.insert(syncOutboxTable).values({
          ...row,
          fieldPatches: JSON.stringify(row.fieldPatches),
        });
      } catch (error) {
        const cause =
          typeof error === "object" && error !== null
            ? (error as { cause?: unknown }).cause
            : undefined;
        const message =
          cause instanceof Error
            ? cause.message
            : error instanceof Error
              ? error.message
              : "";
        if (message.includes("UNIQUE constraint failed")) {
          throw new SyncError("Outbox operation already exists.", "invalid_sync_state", {
            cause: error,
          });
        }
        throw error;
      }

      const [state] = await db
        .select()
        .from(workspaceSyncStateTable)
        .where(
          and(
            eq(workspaceSyncStateTable.workspaceId, row.workspaceId),
            eq(workspaceSyncStateTable.deviceId, row.deviceId)
          )
        );
      if (state === undefined) {
        await db.insert(workspaceSyncStateTable).values({
          workspaceId: row.workspaceId,
          deviceId: row.deviceId,
          remoteWorkspaceId: null,
          lastServerCursor: null,
          lastLocalWorkspaceRevision: 0,
          lastLocalSequence: row.localSequence,
          tombstoneFloor: 0,
          lastFullResyncAt: null,
        });
      } else if (state.lastLocalSequence < row.localSequence) {
        await db
          .update(workspaceSyncStateTable)
          .set({ lastLocalSequence: row.localSequence })
          .where(
            and(
              eq(workspaceSyncStateTable.workspaceId, row.workspaceId),
              eq(workspaceSyncStateTable.deviceId, row.deviceId)
            )
          );
      }
    },

    async listOutbox(workspaceId) {
      const rows = await getDb()
        .select()
        .from(syncOutboxTable)
        .where(eq(syncOutboxTable.workspaceId, workspaceId));
      return rows.map(toOutbox);
    },

    async nextLocalSequence(workspaceId, deviceId) {
      const [state] = await getDb()
        .select({ lastLocalSequence: workspaceSyncStateTable.lastLocalSequence })
        .from(workspaceSyncStateTable)
        .where(
          and(
            eq(workspaceSyncStateTable.workspaceId, workspaceId),
            eq(workspaceSyncStateTable.deviceId, deviceId)
          )
        );
      return (state?.lastLocalSequence ?? 0) + 1;
    },

    async deleteOutbox(opId) {
      await getDb().delete(syncOutboxTable).where(eq(syncOutboxTable.opId, opId));
    },

    async getTombstone(workspaceId, entityType, entityId) {
      const [row] = await getDb()
        .select()
        .from(syncTombstoneTable)
        .where(
          and(
            eq(syncTombstoneTable.workspaceId, workspaceId),
            eq(syncTombstoneTable.entityType, entityType),
            eq(syncTombstoneTable.entityId, entityId)
          )
        );
      return row === undefined ? null : toTombstone(row);
    },

    async listTombstones(workspaceId) {
      const rows = await getDb()
        .select()
        .from(syncTombstoneTable)
        .where(eq(syncTombstoneTable.workspaceId, workspaceId));
      return rows.map(toTombstone);
    },

    async putTombstone(row) {
      await getDb()
        .insert(syncTombstoneTable)
        .values(row)
        .onConflictDoUpdate({
          target: [
            syncTombstoneTable.workspaceId,
            syncTombstoneTable.entityType,
            syncTombstoneTable.entityId,
          ],
          set: {
            tombstoneId: row.tombstoneId,
            deletedAt: row.deletedAt,
            deletedByDeviceId: row.deletedByDeviceId,
            tombstoneWorkspaceRevision: row.tombstoneWorkspaceRevision,
            state: row.state,
            compactedAt: row.compactedAt,
          },
        });
    },

    async listConflicts(workspaceId, state) {
      const rows = await getDb()
        .select()
        .from(syncConflictTable)
        .where(
          state === undefined
            ? eq(syncConflictTable.workspaceId, workspaceId)
            : and(
                eq(syncConflictTable.workspaceId, workspaceId),
                eq(syncConflictTable.state, state)
              )
        );
      return rows.map(toConflict);
    },

    async putConflict(row) {
      await getDb()
        .insert(syncConflictTable)
        .values({
          ...row,
          localValue: JSON.stringify(row.localValue),
          remoteValue: JSON.stringify(row.remoteValue),
        })
        .onConflictDoUpdate({
          target: syncConflictTable.conflictId,
          set: {
            workspaceId: row.workspaceId,
            entityType: row.entityType,
            entityId: row.entityId,
            fieldPath: row.fieldPath,
            localFieldRevision: row.localFieldRevision,
            remoteFieldRevision: row.remoteFieldRevision,
            localOpId: row.localOpId,
            remoteOpId: row.remoteOpId,
            localValue: JSON.stringify(row.localValue),
            remoteValue: JSON.stringify(row.remoteValue),
            localDeviceId: row.localDeviceId,
            remoteDeviceId: row.remoteDeviceId,
            createdAt: row.createdAt,
            state: row.state,
            resolution: row.resolution,
            resolvedAt: row.resolvedAt,
            resolvedByDeviceId: row.resolvedByDeviceId,
          },
        });
    },

    async resolveConflict(conflictId, input) {
      if (input.resolution === "merged" || input.resolution === "copy") {
        throw new SyncError(
          "This resolution requires the sync UI gate.",
          "unsupported_resolution"
        );
      }
      const db = getDb();
      const [row] = await db
        .select()
        .from(syncConflictTable)
        .where(eq(syncConflictTable.conflictId, conflictId));
      if (row === undefined) {
        throw new SyncError("Conflict not found.", "invalid_sync_state");
      }
      const resolved: SyncConflictRow = {
        ...toConflict(row),
        state: "resolved",
        resolution: input.resolution,
        resolvedAt: input.resolvedAt,
        resolvedByDeviceId: input.resolvedByDeviceId,
      };
      await db
        .update(syncConflictTable)
        .set({
          state: resolved.state,
          resolution: resolved.resolution,
          resolvedAt: resolved.resolvedAt,
          resolvedByDeviceId: resolved.resolvedByDeviceId,
        })
        .where(eq(syncConflictTable.conflictId, conflictId));
      return resolved;
    },

    async clearWorkspace(workspaceId) {
      const db = getDb();
      await db.delete(syncMetaTable).where(eq(syncMetaTable.workspaceId, workspaceId));
      await db
        .delete(syncFieldMetaTable)
        .where(eq(syncFieldMetaTable.workspaceId, workspaceId));
      await db
        .delete(syncOutboxTable)
        .where(eq(syncOutboxTable.workspaceId, workspaceId));
      await db
        .delete(workspaceSyncStateTable)
        .where(eq(workspaceSyncStateTable.workspaceId, workspaceId));
      await db
        .delete(syncTombstoneTable)
        .where(eq(syncTombstoneTable.workspaceId, workspaceId));
      await db
        .delete(syncConflictTable)
        .where(eq(syncConflictTable.workspaceId, workspaceId));
      await db
        .delete(syncDevicesTable)
        .where(eq(syncDevicesTable.workspaceId, workspaceId));
    },
  } satisfies SyncStore;
}
