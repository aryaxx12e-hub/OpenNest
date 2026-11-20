import type { CollaborationStore, StorageAdapter } from "@opennest/core";

import type { SyncPolicy } from "./policy";
import type {
  SyncConflictResolution,
  SyncConflictRow,
  SyncDeviceRow,
  SyncEntityType,
  SyncFieldMetaRow,
  SyncMetaRow,
  SyncOperation,
  SyncOutboxRow,
  SyncTombstoneRow,
  WorkspaceSyncStateRow,
} from "./types";

export interface SyncHashEnvelope {
  opId: string;
  workspaceId: string;
  entityType: SyncEntityType;
  entityId: string;
  operation: SyncOperation;
  fieldPatches: Record<string, unknown>;
}

export interface SyncChange {
  workspaceId: string;
  entityType: SyncEntityType;
  entityId: string;
  operation: SyncOperation;
  fieldPatches: Record<string, unknown>;
  at: string;
  contentHash: string | null;
  opId?: string;
}

export interface PreparedSyncChange extends SyncChange {
  opId: string;
  payloadHash: string | null;
}

export type SyncStorageFactory = (
  name?: string,
  policy?: SyncPolicy
) => Promise<SyncCapableStorage>;

export interface SyncStore {
  getOrCreateDevice(workspaceId: string, at: string): Promise<SyncDeviceRow>;
  getDevice(workspaceId: string, deviceId: string): Promise<SyncDeviceRow | null>;
  listDevices(workspaceId: string): Promise<SyncDeviceRow[]>;
  getWorkspaceState(
    workspaceId: string,
    deviceId: string
  ): Promise<WorkspaceSyncStateRow | null>;
  getOrCreateWorkspaceState(
    workspaceId: string,
    deviceId: string,
    at: string
  ): Promise<WorkspaceSyncStateRow>;
  putWorkspaceState(row: WorkspaceSyncStateRow): Promise<void>;
  hasRemoteTarget(workspaceId: string): Promise<boolean>;

  getEntityMeta(
    workspaceId: string,
    entityType: SyncEntityType,
    entityId: string
  ): Promise<SyncMetaRow | null>;
  listEntityMeta(workspaceId: string): Promise<SyncMetaRow[]>;
  putEntityMeta(row: SyncMetaRow): Promise<void>;

  getFieldMeta(
    workspaceId: string,
    entityType: SyncEntityType,
    entityId: string,
    fieldPath: string
  ): Promise<SyncFieldMetaRow | null>;
  listFieldMeta(workspaceId: string): Promise<SyncFieldMetaRow[]>;
  putFieldMeta(row: SyncFieldMetaRow): Promise<void>;

  appendOutbox(row: SyncOutboxRow): Promise<void>;
  listOutbox(workspaceId: string): Promise<SyncOutboxRow[]>;
  nextLocalSequence(workspaceId: string, deviceId: string): Promise<number>;
  deleteOutbox(opId: string): Promise<void>;

  getTombstone(
    workspaceId: string,
    entityType: SyncEntityType,
    entityId: string
  ): Promise<SyncTombstoneRow | null>;
  listTombstones(workspaceId: string): Promise<SyncTombstoneRow[]>;
  putTombstone(row: SyncTombstoneRow): Promise<void>;

  listConflicts(
    workspaceId: string,
    state?: "open" | "resolved"
  ): Promise<SyncConflictRow[]>;
  putConflict(row: SyncConflictRow): Promise<void>;
  resolveConflict(
    conflictId: string,
    input: {
      resolution: SyncConflictResolution;
      resolvedAt: string;
      resolvedByDeviceId: string;
    }
  ): Promise<SyncConflictRow>;

  clearWorkspace(workspaceId: string): Promise<void>;
}

export interface SyncCapableStorage extends StorageAdapter {
  readonly sync: SyncStore;
  readonly collaboration: CollaborationStore;
}
