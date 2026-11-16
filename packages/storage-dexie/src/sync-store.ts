import { generateId } from "@opennest/core";
import {
  SyncError,
  type SyncConflictRow,
  type SyncDeviceRow,
  type SyncFieldMetaRow,
  type SyncMetaRow,
  type SyncOutboxRow,
  type SyncStore,
  type SyncTombstoneRow,
  type WorkspaceSyncStateRow,
} from "@opennest/sync";

import type { OpenNestDexie } from "./schema";

export function createDexieSyncStore(db: OpenNestDexie): SyncStore {
  return {
    async getOrCreateDevice(workspaceId, at) {
      const devices = await db.sync_devices.toArray();
      const existing = devices.find((row) => row.workspaceId === workspaceId);
      if (existing !== undefined) {
        return existing;
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
      await db.sync_devices.put(row);
      return row;
    },

    async getDevice(workspaceId, deviceId) {
      return (await db.sync_devices.get([workspaceId, deviceId])) ?? null;
    },

    async listDevices(workspaceId) {
      return db.sync_devices.filter((row) => row.workspaceId === workspaceId).toArray();
    },

    async getWorkspaceState(workspaceId, deviceId) {
      return (await db.workspace_sync_state.get([workspaceId, deviceId])) ?? null;
    },

    async getOrCreateWorkspaceState(workspaceId, deviceId, at) {
      const existing = await db.workspace_sync_state.get([workspaceId, deviceId]);
      if (existing !== undefined) {
        return existing;
      }

      const row: WorkspaceSyncStateRow = {
        workspaceId,
        deviceId,
        remoteWorkspaceId: null,
        lastServerCursor: null,
        lastLocalWorkspaceRevision: 0,
        lastLocalSequence: 0,
        tombstoneFloor: 0,
        lastFullResyncAt: at,
      };
      await db.workspace_sync_state.put(row);
      return row;
    },

    async putWorkspaceState(row) {
      await db.workspace_sync_state.put(row);
    },

    async hasRemoteTarget(workspaceId) {
      return db.workspace_sync_state
        .filter(
          (row) => row.workspaceId === workspaceId && row.remoteWorkspaceId !== null
        )
        .count()
        .then((count) => count > 0);
    },

    async getEntityMeta(workspaceId, entityType, entityId) {
      return (await db.sync_meta.get([workspaceId, entityType, entityId])) ?? null;
    },

    async listEntityMeta(workspaceId) {
      return db.sync_meta.filter((row) => row.workspaceId === workspaceId).toArray();
    },

    async putEntityMeta(row) {
      await db.sync_meta.put(row);
    },

    async getFieldMeta(workspaceId, entityType, entityId, fieldPath) {
      return (
        (await db.sync_field_meta.get([workspaceId, entityType, entityId, fieldPath])) ??
        null
      );
    },

    async listFieldMeta(workspaceId) {
      return db.sync_field_meta
        .filter((row) => row.workspaceId === workspaceId)
        .toArray();
    },

    async putFieldMeta(row) {
      await db.sync_field_meta.put(row);
    },

    async appendOutbox(row) {
      try {
        await db.sync_outbox.add(row);
      } catch (error) {
        const name =
          typeof error === "object" && error !== null
            ? (error as { name?: unknown }).name
            : undefined;
        if (name === "ConstraintError") {
          throw new SyncError("Outbox operation already exists.", "invalid_sync_state", {
            cause: error,
          });
        }
        throw error;
      }

      const state = await db.workspace_sync_state.get([row.workspaceId, row.deviceId]);
      if (state === undefined || state.lastLocalSequence < row.localSequence) {
        await db.workspace_sync_state.put({
          ...(state ?? {
            workspaceId: row.workspaceId,
            deviceId: row.deviceId,
            remoteWorkspaceId: null,
            lastServerCursor: null,
            lastLocalWorkspaceRevision: 0,
            tombstoneFloor: 0,
            lastFullResyncAt: null,
          }),
          lastLocalSequence: row.localSequence,
        });
      }
    },

    async listOutbox(workspaceId) {
      return db.sync_outbox.filter((row) => row.workspaceId === workspaceId).toArray();
    },

    async nextLocalSequence(workspaceId, deviceId) {
      const state = await db.workspace_sync_state.get([workspaceId, deviceId]);
      return (state?.lastLocalSequence ?? 0) + 1;
    },

    async deleteOutbox(opId) {
      await db.sync_outbox.delete(opId);
    },

    async getTombstone(workspaceId, entityType, entityId) {
      return (await db.sync_tombstone.get([workspaceId, entityType, entityId])) ?? null;
    },

    async listTombstones(workspaceId) {
      return db.sync_tombstone.filter((row) => row.workspaceId === workspaceId).toArray();
    },

    async putTombstone(row) {
      await db.sync_tombstone.put(row);
    },

    async listConflicts(workspaceId, state) {
      return db.sync_conflict
        .filter(
          (row) =>
            row.workspaceId === workspaceId &&
            (state === undefined || row.state === state)
        )
        .toArray();
    },

    async putConflict(row) {
      await db.sync_conflict.put(row);
    },

    async resolveConflict(conflictId, input) {
      if (input.resolution === "merged" || input.resolution === "copy") {
        throw new SyncError(
          "This resolution requires the sync UI gate.",
          "unsupported_resolution"
        );
      }
      const row = await db.sync_conflict.get(conflictId);
      if (row === undefined) {
        throw new SyncError("Conflict not found.", "invalid_sync_state");
      }
      const resolved: SyncConflictRow = {
        ...row,
        state: "resolved",
        resolution: input.resolution,
        resolvedAt: input.resolvedAt,
        resolvedByDeviceId: input.resolvedByDeviceId,
      };
      await db.sync_conflict.put(resolved);
      return resolved;
    },

    async clearWorkspace(workspaceId) {
      const metaKeys = await db.sync_meta
        .filter((row: SyncMetaRow) => row.workspaceId === workspaceId)
        .primaryKeys();
      const fieldKeys = await db.sync_field_meta
        .filter((row: SyncFieldMetaRow) => row.workspaceId === workspaceId)
        .primaryKeys();
      const outboxKeys = await db.sync_outbox
        .filter((row: SyncOutboxRow) => row.workspaceId === workspaceId)
        .primaryKeys();
      const stateKeys = await db.workspace_sync_state
        .filter((row: WorkspaceSyncStateRow) => row.workspaceId === workspaceId)
        .primaryKeys();
      const tombstoneKeys = await db.sync_tombstone
        .filter((row: SyncTombstoneRow) => row.workspaceId === workspaceId)
        .primaryKeys();
      const conflictKeys = await db.sync_conflict
        .filter((row: SyncConflictRow) => row.workspaceId === workspaceId)
        .primaryKeys();
      const deviceKeys = await db.sync_devices
        .filter((row: SyncDeviceRow) => row.workspaceId === workspaceId)
        .primaryKeys();

      await db.sync_meta.bulkDelete(metaKeys);
      await db.sync_field_meta.bulkDelete(fieldKeys);
      await db.sync_outbox.bulkDelete(outboxKeys);
      await db.workspace_sync_state.bulkDelete(stateKeys);
      await db.sync_tombstone.bulkDelete(tombstoneKeys);
      await db.sync_conflict.bulkDelete(conflictKeys);
      await db.sync_devices.bulkDelete(deviceKeys);
    },
  } satisfies SyncStore;
}
