import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import type {
  SyncConflict,
  SyncEntityType,
  SyncOperationType,
} from "@opennest/sync-protocol";

const SCHEMA = readFileSync(
  fileURLToPath(new URL("./schema.sql", import.meta.url)),
  "utf8"
);

const REQUIRED_TABLES = [
  "workspaces",
  "notes",
  "folders",
  "files",
  "tags",
  "file_tags",
  "note_tags",
  "note_links",
  "sync_meta",
  "sync_field_meta",
  "sync_tombstone",
  "sync_conflict",
] as const;

export interface SyncStore {
  readonly databaseFile: string;
  readonly sqlite: DatabaseSync;
  transaction<T>(work: () => T): T;
  close(): void;
}

export interface OpenSyncStoreOptions {
  databaseFile: string;
}

export interface AppliedOperationRecord {
  opId: string;
  workspaceId: string;
  deviceId: string;
  entityType: SyncEntityType;
  entityId: string;
  operation: SyncOperationType;
  baseEntityRevision: number;
  baseWorkspaceRevision: number;
  fieldPatches: Record<string, unknown>;
  payloadHash: string;
  localSequence: number;
  createdAt: string;
  canonicalRevision: number;
  appliedAt: string;
  entityRevision: number;
  fieldRevisions: Record<string, number>;
}

export interface EntityMetaRecord {
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

export interface FieldMetaRecord {
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

export interface TombstoneRecord {
  tombstoneId: string;
  workspaceId: string;
  entityType: SyncEntityType;
  entityId: string;
  deletedAt: string;
  deletedByDeviceId: string;
  tombstoneWorkspaceRevision: number;
  state: "active" | "compacted";
  compactedAt: string | null;
}

export interface StoredConflict extends SyncConflict {
  resolution: "local" | "remote" | "merged" | "copy";
}

interface AppliedOperationRow {
  op_id: string;
  workspace_id: string;
  device_id: string;
  entity_type: string;
  entity_id: string;
  operation: string;
  base_entity_revision: number;
  base_workspace_revision: number;
  field_patches: string;
  payload_hash: string;
  local_sequence: number;
  created_at: string;
  canonical_revision: number;
  applied_at: string;
  entity_revision: number;
  field_revisions: string;
}

interface EntityMetaRow {
  workspace_id: string;
  entity_type: string;
  entity_id: string;
  entity_revision: number;
  workspace_revision: number;
  origin_device_id: string;
  updated_at: string;
  deleted_at: string | null;
  content_hash: string | null;
}

interface FieldMetaRow {
  workspace_id: string;
  entity_type: string;
  entity_id: string;
  field_path: string;
  field_revision: number;
  workspace_revision: number;
  origin_device_id: string;
  updated_at: string;
  deleted_at: string | null;
}

interface TombstoneRow {
  tombstone_id: string;
  workspace_id: string;
  entity_type: string;
  entity_id: string;
  deleted_at: string;
  deleted_by_device_id: string;
  tombstone_workspace_revision: number;
  state: string;
  compacted_at: string | null;
}

interface ConflictRow {
  conflict_id: string;
  workspace_id: string;
  entity_type: string;
  entity_id: string;
  field_path: string;
  local_field_revision: number;
  remote_field_revision: number;
  local_op_id: string;
  remote_op_id: string;
  local_value: string;
  remote_value: string;
  local_device_id: string;
  remote_device_id: string;
  created_at: string;
  state: string;
  resolution: string | null;
  resolved_at: string | null;
  resolved_by_device_id: string | null;
}

function tryRollback(sqlite: DatabaseSync): boolean {
  try {
    sqlite.exec("ROLLBACK");
    return true;
  } catch {
    return false;
  }
}

function requiresTables(sqlite: DatabaseSync): void {
  const statement = sqlite.prepare(
    "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?"
  );

  for (const table of REQUIRED_TABLES) {
    if (statement.get(table) === undefined) {
      throw new Error("The workspace sync schema is incomplete.");
    }
  }
}

export function openSyncStore(options: OpenSyncStoreOptions): SyncStore {
  mkdirSync(path.dirname(options.databaseFile), { recursive: true, mode: 0o700 });
  const sqlite = new DatabaseSync(options.databaseFile);

  try {
    sqlite.exec("PRAGMA foreign_keys = ON");
    sqlite.exec("PRAGMA journal_mode = WAL");
    sqlite.exec("PRAGMA busy_timeout = 5000");
    requiresTables(sqlite);
    sqlite.exec(SCHEMA);
  } catch (error) {
    sqlite.close();
    throw error;
  }

  return {
    databaseFile: options.databaseFile,
    sqlite,
    transaction<T>(work: () => T): T {
      sqlite.exec("BEGIN IMMEDIATE");

      try {
        const result = work();
        sqlite.exec("COMMIT");
        return result;
      } catch (error) {
        tryRollback(sqlite);
        throw error;
      }
    },
    close() {
      sqlite.close();
    },
  };
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function toAppliedOperation(row: AppliedOperationRow): AppliedOperationRecord {
  return {
    opId: row.op_id,
    workspaceId: row.workspace_id,
    deviceId: row.device_id,
    entityType: row.entity_type as SyncEntityType,
    entityId: row.entity_id,
    operation: row.operation as SyncOperationType,
    baseEntityRevision: row.base_entity_revision,
    baseWorkspaceRevision: row.base_workspace_revision,
    fieldPatches: parseJson(row.field_patches),
    payloadHash: row.payload_hash,
    localSequence: row.local_sequence,
    createdAt: row.created_at,
    canonicalRevision: row.canonical_revision,
    appliedAt: row.applied_at,
    entityRevision: row.entity_revision,
    fieldRevisions: parseJson(row.field_revisions),
  };
}

function toEntityMeta(row: EntityMetaRow): EntityMetaRecord {
  return {
    workspaceId: row.workspace_id,
    entityType: row.entity_type as SyncEntityType,
    entityId: row.entity_id,
    entityRevision: row.entity_revision,
    workspaceRevision: row.workspace_revision,
    originDeviceId: row.origin_device_id,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    contentHash: row.content_hash,
  };
}

function toFieldMeta(row: FieldMetaRow): FieldMetaRecord {
  return {
    workspaceId: row.workspace_id,
    entityType: row.entity_type as SyncEntityType,
    entityId: row.entity_id,
    fieldPath: row.field_path,
    fieldRevision: row.field_revision,
    workspaceRevision: row.workspace_revision,
    originDeviceId: row.origin_device_id,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function toTombstone(row: TombstoneRow): TombstoneRecord {
  return {
    tombstoneId: row.tombstone_id,
    workspaceId: row.workspace_id,
    entityType: row.entity_type as SyncEntityType,
    entityId: row.entity_id,
    deletedAt: row.deleted_at,
    deletedByDeviceId: row.deleted_by_device_id,
    tombstoneWorkspaceRevision: row.tombstone_workspace_revision,
    state: row.state as TombstoneRecord["state"],
    compactedAt: row.compacted_at,
  };
}

function toConflict(row: ConflictRow): StoredConflict {
  return {
    conflictId: row.conflict_id,
    entityType: row.entity_type as SyncEntityType,
    entityId: row.entity_id,
    fieldPath: row.field_path,
    localFieldRevision: row.local_field_revision,
    remoteFieldRevision: row.remote_field_revision,
    localOpId: row.local_op_id,
    remoteOpId: row.remote_op_id,
    localValue: parseJson(row.local_value),
    remoteValue: parseJson(row.remote_value),
    localDeviceId: row.local_device_id,
    remoteDeviceId: row.remote_device_id,
    createdAt: row.created_at as SyncConflict["createdAt"],
    resolution: (row.resolution ?? "remote") as StoredConflict["resolution"],
  };
}

export function readAppliedOperation(
  sqlite: DatabaseSync,
  opId: string
): AppliedOperationRecord | null {
  const row = sqlite
    .prepare("SELECT * FROM sync_applied_operations WHERE op_id = ?")
    .get(opId) as AppliedOperationRow | undefined;

  return row === undefined ? null : toAppliedOperation(row);
}

export function insertAppliedOperation(
  sqlite: DatabaseSync,
  operation: AppliedOperationRecord
): void {
  sqlite
    .prepare(
      `INSERT INTO sync_applied_operations (
        op_id, workspace_id, device_id, entity_type, entity_id, operation,
        base_entity_revision, base_workspace_revision, field_patches,
        payload_hash, local_sequence, created_at, canonical_revision,
        applied_at, entity_revision, field_revisions
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      operation.opId,
      operation.workspaceId,
      operation.deviceId,
      operation.entityType,
      operation.entityId,
      operation.operation,
      operation.baseEntityRevision,
      operation.baseWorkspaceRevision,
      JSON.stringify(operation.fieldPatches),
      operation.payloadHash,
      operation.localSequence,
      operation.createdAt,
      operation.canonicalRevision,
      operation.appliedAt,
      operation.entityRevision,
      JSON.stringify(operation.fieldRevisions)
    );
}

export function listAppliedOperations(
  sqlite: DatabaseSync,
  workspaceId: string,
  afterCanonicalRevision: number,
  limit: number
): AppliedOperationRecord[] {
  const rows = sqlite
    .prepare(
      `SELECT * FROM sync_applied_operations
       WHERE workspace_id = ? AND canonical_revision > ?
       ORDER BY canonical_revision ASC
       LIMIT ?`
    )
    .all(workspaceId, afterCanonicalRevision, limit) as unknown as AppliedOperationRow[];

  return rows.map(toAppliedOperation);
}

export function readAuthorityRevision(sqlite: DatabaseSync, workspaceId: string): number {
  const row = sqlite
    .prepare("SELECT canonical_revision FROM sync_authority_state WHERE workspace_id = ?")
    .get(workspaceId) as { canonical_revision: number } | undefined;

  return row?.canonical_revision ?? 0;
}

export function writeAuthorityRevision(
  sqlite: DatabaseSync,
  workspaceId: string,
  canonicalRevision: number,
  updatedAt: string
): void {
  sqlite
    .prepare(
      `INSERT INTO sync_authority_state (workspace_id, canonical_revision, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT (workspace_id) DO UPDATE SET
         canonical_revision = excluded.canonical_revision,
         updated_at = excluded.updated_at`
    )
    .run(workspaceId, canonicalRevision, updatedAt);
}

export function readEntityMeta(
  sqlite: DatabaseSync,
  workspaceId: string,
  entityType: SyncEntityType,
  entityId: string
): EntityMetaRecord | null {
  const row = sqlite
    .prepare(
      `SELECT * FROM sync_meta
       WHERE workspace_id = ? AND entity_type = ? AND entity_id = ?`
    )
    .get(workspaceId, entityType, entityId) as EntityMetaRow | undefined;

  return row === undefined ? null : toEntityMeta(row);
}

export function writeEntityMeta(sqlite: DatabaseSync, meta: EntityMetaRecord): void {
  sqlite
    .prepare(
      `INSERT INTO sync_meta (
        workspace_id, entity_type, entity_id, entity_revision,
        workspace_revision, origin_device_id, updated_at, deleted_at, content_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (workspace_id, entity_type, entity_id) DO UPDATE SET
        entity_revision = excluded.entity_revision,
        workspace_revision = excluded.workspace_revision,
        origin_device_id = excluded.origin_device_id,
        updated_at = excluded.updated_at,
        deleted_at = excluded.deleted_at,
        content_hash = excluded.content_hash`
    )
    .run(
      meta.workspaceId,
      meta.entityType,
      meta.entityId,
      meta.entityRevision,
      meta.workspaceRevision,
      meta.originDeviceId,
      meta.updatedAt,
      meta.deletedAt,
      meta.contentHash
    );
}

export function readFieldMeta(
  sqlite: DatabaseSync,
  workspaceId: string,
  entityType: SyncEntityType,
  entityId: string,
  fieldPath: string
): FieldMetaRecord | null {
  const row = sqlite
    .prepare(
      `SELECT * FROM sync_field_meta
       WHERE workspace_id = ? AND entity_type = ? AND entity_id = ? AND field_path = ?`
    )
    .get(workspaceId, entityType, entityId, fieldPath) as FieldMetaRow | undefined;

  return row === undefined ? null : toFieldMeta(row);
}

export function writeFieldMeta(sqlite: DatabaseSync, meta: FieldMetaRecord): void {
  sqlite
    .prepare(
      `INSERT INTO sync_field_meta (
        workspace_id, entity_type, entity_id, field_path, field_revision,
        workspace_revision, origin_device_id, updated_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (workspace_id, entity_type, entity_id, field_path) DO UPDATE SET
        field_revision = excluded.field_revision,
        workspace_revision = excluded.workspace_revision,
        origin_device_id = excluded.origin_device_id,
        updated_at = excluded.updated_at,
        deleted_at = excluded.deleted_at`
    )
    .run(
      meta.workspaceId,
      meta.entityType,
      meta.entityId,
      meta.fieldPath,
      meta.fieldRevision,
      meta.workspaceRevision,
      meta.originDeviceId,
      meta.updatedAt,
      meta.deletedAt
    );
}

export function markEntityFieldsDeleted(
  sqlite: DatabaseSync,
  workspaceId: string,
  entityType: SyncEntityType,
  entityId: string,
  deletedAt: string
): void {
  sqlite
    .prepare(
      `UPDATE sync_field_meta SET deleted_at = ?, updated_at = ?
       WHERE workspace_id = ? AND entity_type = ? AND entity_id = ?`
    )
    .run(deletedAt, deletedAt, workspaceId, entityType, entityId);
}

export function clearEntityFieldsDeleted(
  sqlite: DatabaseSync,
  workspaceId: string,
  entityType: SyncEntityType,
  entityId: string
): void {
  sqlite
    .prepare(
      `UPDATE sync_field_meta SET deleted_at = NULL
       WHERE workspace_id = ? AND entity_type = ? AND entity_id = ?`
    )
    .run(workspaceId, entityType, entityId);
}

export function readTombstone(
  sqlite: DatabaseSync,
  workspaceId: string,
  entityType: SyncEntityType,
  entityId: string
): TombstoneRecord | null {
  const row = sqlite
    .prepare(
      `SELECT * FROM sync_tombstone
       WHERE workspace_id = ? AND entity_type = ? AND entity_id = ?`
    )
    .get(workspaceId, entityType, entityId) as TombstoneRow | undefined;

  return row === undefined ? null : toTombstone(row);
}

export function writeTombstone(sqlite: DatabaseSync, tombstone: TombstoneRecord): void {
  sqlite
    .prepare(
      `INSERT INTO sync_tombstone (
        tombstone_id, workspace_id, entity_type, entity_id, deleted_at,
        deleted_by_device_id, tombstone_workspace_revision, state, compacted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (workspace_id, entity_type, entity_id) DO UPDATE SET
        tombstone_id = excluded.tombstone_id,
        deleted_at = excluded.deleted_at,
        deleted_by_device_id = excluded.deleted_by_device_id,
        tombstone_workspace_revision = excluded.tombstone_workspace_revision,
        state = excluded.state,
        compacted_at = excluded.compacted_at`
    )
    .run(
      tombstone.tombstoneId,
      tombstone.workspaceId,
      tombstone.entityType,
      tombstone.entityId,
      tombstone.deletedAt,
      tombstone.deletedByDeviceId,
      tombstone.tombstoneWorkspaceRevision,
      tombstone.state,
      tombstone.compactedAt
    );
}

export function deleteTombstone(
  sqlite: DatabaseSync,
  workspaceId: string,
  entityType: SyncEntityType,
  entityId: string
): void {
  sqlite
    .prepare(
      `DELETE FROM sync_tombstone
       WHERE workspace_id = ? AND entity_type = ? AND entity_id = ?`
    )
    .run(workspaceId, entityType, entityId);
}

export function insertConflict(
  sqlite: DatabaseSync,
  workspaceId: string,
  conflict: StoredConflict
): void {
  sqlite
    .prepare(
      `INSERT INTO sync_conflict (
        conflict_id, workspace_id, entity_type, entity_id, field_path,
        local_field_revision, remote_field_revision, local_op_id, remote_op_id,
        local_value, remote_value, local_device_id, remote_device_id,
        created_at, state, resolution, resolved_at, resolved_by_device_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      conflict.conflictId,
      workspaceId,
      conflict.entityType,
      conflict.entityId,
      conflict.fieldPath,
      conflict.localFieldRevision,
      conflict.remoteFieldRevision,
      conflict.localOpId,
      conflict.remoteOpId,
      JSON.stringify(conflict.localValue),
      JSON.stringify(conflict.remoteValue),
      conflict.localDeviceId,
      conflict.remoteDeviceId,
      conflict.createdAt,
      "open",
      conflict.resolution,
      null,
      null
    );
}

export function listConflictsForOperation(
  sqlite: DatabaseSync,
  workspaceId: string,
  opId: string
): StoredConflict[] {
  const rows = sqlite
    .prepare(
      `SELECT * FROM sync_conflict
       WHERE workspace_id = ? AND remote_op_id = ?
       ORDER BY created_at ASC, rowid ASC`
    )
    .all(workspaceId, opId) as unknown as ConflictRow[];

  return rows.map(toConflict);
}

export function findLastAppliedFieldOperation(
  sqlite: DatabaseSync,
  workspaceId: string,
  entityType: SyncEntityType,
  entityId: string,
  fieldPath: string
): string | null {
  const rows = sqlite
    .prepare(
      `SELECT op_id, field_patches FROM sync_applied_operations
       WHERE workspace_id = ? AND entity_type = ? AND entity_id = ?
       ORDER BY canonical_revision DESC
       LIMIT 100`
    )
    .all(workspaceId, entityType, entityId) as Array<{
    op_id: string;
    field_patches: string;
  }>;

  for (const row of rows) {
    const patches = parseJson<Record<string, unknown>>(row.field_patches);

    if (Object.hasOwn(patches, fieldPath)) {
      return row.op_id;
    }
  }

  return null;
}
