export type SyncEntityType = "workspace" | "folder" | "file" | "note" | "tag";

export type SyncOperation = "create" | "update" | "delete" | "restore";

export type SyncOutboxState = "pending" | "in_flight" | "retry" | "acked" | "failed";

export type SyncTombstoneState = "active" | "compacted";

export type SyncConflictState = "open" | "resolved";

export type SyncConflictResolution = "local" | "remote" | "merged" | "copy";

export type SyncDeviceState = "active" | "stale" | "revoked";

export interface SyncMetaRow {
  workspaceId: string;
  entityType: SyncEntityType;
  entityId: string;
  entityRevision: number;
  workspaceRevision: number;
  originDeviceId: string;
  updatedAt: string;
  deletedAt: string | null;
  contentHash: string | null;
}

export interface SyncFieldMetaRow {
  workspaceId: string;
  entityType: SyncEntityType;
  entityId: string;
  fieldPath: string;
  fieldRevision: number;
  workspaceRevision: number;
  originDeviceId: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface SyncOutboxRow {
  opId: string;
  workspaceId: string;
  entityType: SyncEntityType;
  entityId: string;
  operation: SyncOperation;
  baseEntityRevision: number;
  baseWorkspaceRevision: number;
  fieldPatches: Record<string, unknown>;
  payloadHash: string;
  createdAt: string;
  deviceId: string;
  localSequence: number;
  attempts: number;
  state: SyncOutboxState;
  ackedAt: string | null;
}

export interface WorkspaceSyncStateRow {
  workspaceId: string;
  deviceId: string;
  remoteWorkspaceId: string | null;
  lastServerCursor: string | null;
  lastLocalWorkspaceRevision: number;
  lastLocalSequence: number;
  tombstoneFloor: number;
  lastFullResyncAt: string | null;
}

export interface SyncTombstoneRow {
  tombstoneId: string;
  workspaceId: string;
  entityType: SyncEntityType;
  entityId: string;
  deletedAt: string;
  deletedByDeviceId: string;
  tombstoneWorkspaceRevision: number;
  state: SyncTombstoneState;
  compactedAt: string | null;
}

export interface SyncConflictRow {
  conflictId: string;
  workspaceId: string;
  entityType: SyncEntityType;
  entityId: string;
  fieldPath: string;
  localFieldRevision: number;
  remoteFieldRevision: number;
  localOpId: string;
  remoteOpId: string;
  localValue: unknown;
  remoteValue: unknown;
  localDeviceId: string;
  remoteDeviceId: string;
  createdAt: string;
  state: SyncConflictState;
  resolution: SyncConflictResolution | null;
  resolvedAt: string | null;
  resolvedByDeviceId: string | null;
}

export interface SyncDeviceRow {
  workspaceId: string;
  deviceId: string;
  registeredAt: string;
  lastSeenAt: string;
  lastAckedTombstoneWorkspaceRevision: number;
  state: SyncDeviceState;
  publicKey: string | null;
}
