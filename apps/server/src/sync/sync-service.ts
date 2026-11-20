import { isDeepStrictEqual } from "node:util";
import type { DatabaseSync } from "node:sqlite";

import { generateId, type IsoDate } from "@opennest/core";
import { canonicalIdList, fieldClass, payloadHash } from "@opennest/sync";
import {
  MAX_SYNC_BATCH_OPERATIONS,
  MAX_SYNC_CURSOR_LENGTH,
  MAX_SYNC_PULL_OPERATIONS,
  SYNC_PROTOCOL_VERSION,
  type AppliedOperation,
  type PullRequest,
  type PullResponse,
  type PushRequest,
  type PushResponse,
  type SyncConflict,
  type SyncEntityType,
  type SyncOperation,
  type SyncOperationType,
} from "@opennest/sync-protocol";
import {
  blobKeySchema,
  checksumSchema,
  displayNameSchema,
  folderIdSchema,
  mimeTypeSchema,
  noteContentSchema,
  noteIdSchema,
  noteTitleSchema,
  sizeBytesSchema,
  tagColorSchema,
  tagIdSchema,
  tagNameSchema,
} from "@opennest/validation";

import type { Role } from "../auth/membership";
import {
  clearEntityFieldsDeleted,
  deleteTombstone,
  findLastAppliedFieldOperation,
  insertAppliedOperation,
  insertConflict,
  listAppliedOperations,
  listConflictsForOperation,
  markEntityFieldsDeleted,
  readAppliedOperation,
  readAuthorityRevision,
  readEntityMeta,
  readFieldMeta,
  readTombstone,
  writeAuthorityRevision,
  writeEntityMeta,
  writeFieldMeta,
  writeTombstone,
  type AppliedOperationRecord,
  type StoredConflict,
  type SyncStore,
} from "./sync-store";

const CURSOR_VERSION = "v1";
const MAX_RELATION_IDS = 500;
const CURSOR_PATTERN = /^[A-Za-z0-9_-]+$/;

type SqlValue = string | number | null;
type FieldSchema<T> = {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
};

interface EntitySnapshot {
  values: Record<string, unknown>;
  tagIds: string[];
  targetNoteIds: string[];
}

interface ApplyOutcome {
  operation: AppliedOperationRecord;
  conflicts: StoredConflict[];
}

export interface SyncActor {
  userId: string;
  role: Role;
}

export interface SyncService {
  push(request: PushRequest, actor: SyncActor): Promise<PushResponse>;
  pull(request: PullRequest, actor: SyncActor): Promise<PullResponse>;
}

export interface CreateSyncServiceOptions {
  store: SyncStore;
  now?: () => Date;
}

export type SyncServiceErrorCode =
  | "forbidden"
  | "not_found"
  | "invalid_operation"
  | "invalid_payload_hash"
  | "invalid_cursor"
  | "invalid_sync_state"
  | "tombstoned_entity";

export class SyncServiceError extends Error {
  readonly status: number;
  readonly code: SyncServiceErrorCode;

  constructor(
    status: number,
    code: SyncServiceErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "SyncServiceError";
    this.status = status;
    this.code = code;
  }
}

const ENTITY_FIELDS: Record<SyncEntityType, readonly string[]> = {
  workspace: ["name"],
  folder: ["name", "parentId"],
  file: ["name", "folderId", "mimeType", "sizeBytes", "blobKey", "checksum", "tagIds"],
  note: ["title", "content", "pinned", "folderId", "tagIds", "targetNoteIds"],
  tag: ["name", "color"],
};

const UPDATE_FIELDS: Record<SyncEntityType, readonly string[]> = {
  workspace: ["name"],
  folder: ["name", "parentId"],
  file: ["name", "folderId", "tagIds"],
  note: ["title", "content", "pinned", "folderId", "tagIds", "targetNoteIds"],
  tag: ["name", "color"],
};

function invalid(message: string, code: SyncServiceErrorCode = "invalid_operation") {
  return new SyncServiceError(400, code, message);
}

function parseField<T>(schema: FieldSchema<T>, value: unknown, field: string): T {
  const parsed = schema.safeParse(value);

  if (!parsed.success) {
    throw invalid(`The ${field} field is not valid.`);
  }

  return parsed.data;
}

function parseNullableField<T>(
  schema: FieldSchema<T>,
  value: unknown,
  field: string
): T | null {
  if (value === null) {
    return null;
  }

  return parseField(schema, value, field);
}

function parseBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw invalid(`The ${field} field must be a boolean.`);
  }

  return value;
}

function parseIdList(
  value: unknown,
  schema: FieldSchema<string>,
  field: string
): string[] {
  if (!Array.isArray(value) || value.length > MAX_RELATION_IDS) {
    throw invalid(`The ${field} field is not valid.`);
  }

  return canonicalIdList(value.map((item) => parseField(schema, item, field)));
}

function normalizePatches(
  entityType: SyncEntityType,
  operation: SyncOperationType,
  patches: Record<string, unknown>
): Record<string, unknown> {
  const keys = Object.keys(patches);

  if (operation === "delete") {
    if (keys.length > 0) {
      throw invalid("A delete operation must not contain field patches.");
    }

    return {};
  }

  if (keys.length === 0) {
    throw invalid("The operation must contain at least one field patch.");
  }

  const allowed =
    operation === "update" ? UPDATE_FIELDS[entityType] : ENTITY_FIELDS[entityType];
  const normalized: Record<string, unknown> = {};

  for (const key of keys) {
    if (!allowed.includes(key)) {
      throw invalid(`The ${key} field is not valid for this operation.`);
    }

    const value = patches[key];

    switch (entityType) {
      case "workspace":
        normalized.name = parseField(displayNameSchema, value, "name");
        break;
      case "folder":
        if (key === "name") {
          normalized.name = parseField(displayNameSchema, value, "name");
        } else {
          normalized.parentId = parseNullableField(folderIdSchema, value, "parentId");
        }
        break;
      case "file":
        if (key === "name") {
          normalized.name = parseField(displayNameSchema, value, "name");
        } else if (key === "folderId") {
          normalized.folderId = parseNullableField(folderIdSchema, value, "folderId");
        } else if (key === "mimeType") {
          normalized.mimeType = parseNullableField(mimeTypeSchema, value, "mimeType");
        } else if (key === "sizeBytes") {
          normalized.sizeBytes = parseField(sizeBytesSchema, value, "sizeBytes");
        } else if (key === "blobKey") {
          normalized.blobKey = parseField(blobKeySchema, value, "blobKey");
        } else if (key === "checksum") {
          normalized.checksum = parseNullableField(checksumSchema, value, "checksum");
        } else {
          normalized.tagIds = parseIdList(value, tagIdSchema, "tagIds");
        }
        break;
      case "note":
        if (key === "title") {
          normalized.title = parseField(noteTitleSchema, value, "title");
        } else if (key === "content") {
          normalized.content = parseField(noteContentSchema, value, "content");
        } else if (key === "pinned") {
          normalized.pinned = parseBoolean(value, "pinned");
        } else if (key === "folderId") {
          normalized.folderId = parseNullableField(folderIdSchema, value, "folderId");
        } else if (key === "tagIds") {
          normalized.tagIds = parseIdList(value, tagIdSchema, "tagIds");
        } else {
          normalized.targetNoteIds = parseIdList(value, noteIdSchema, "targetNoteIds");
        }
        break;
      case "tag":
        if (key === "name") {
          normalized.name = parseField(tagNameSchema, value, "name");
        } else {
          normalized.color = parseNullableField(tagColorSchema, value, "color");
        }
        break;
    }
  }

  return normalized;
}

function assertRequired(
  entityType: SyncEntityType,
  patches: Record<string, unknown>
): void {
  const required: Partial<Record<SyncEntityType, readonly string[]>> = {
    folder: ["name"],
    file: ["name", "sizeBytes", "blobKey"],
    note: ["title"],
    tag: ["name"],
  };
  const fields = required[entityType] ?? [];

  for (const field of fields) {
    if (!Object.hasOwn(patches, field)) {
      throw invalid(`The ${field} field is required.`);
    }
  }
}

function assertWorkspace(sqlite: DatabaseSync, workspaceId: string): void {
  const workspaces = sqlite.prepare("SELECT id FROM workspaces").all() as Array<{
    id: string;
  }>;

  if (workspaces.length === 0) {
    throw new SyncServiceError(404, "not_found", "The workspace was not found.");
  }

  if (workspaces.length > 1) {
    throw new SyncServiceError(
      409,
      "invalid_sync_state",
      "The server has more than one workspace."
    );
  }

  if (workspaces[0]?.id !== workspaceId) {
    throw new SyncServiceError(404, "not_found", "The workspace was not found.");
  }
}

function requireWriteRole(actor: SyncActor): void {
  if (actor.role !== "owner" && actor.role !== "editor") {
    throw new SyncServiceError(
      403,
      "forbidden",
      "You are not allowed to push sync operations."
    );
  }
}

function requireReadRole(actor: SyncActor): void {
  if (actor.role !== "owner" && actor.role !== "editor" && actor.role !== "viewer") {
    throw new SyncServiceError(
      403,
      "forbidden",
      "You are not allowed to pull sync operations."
    );
  }
}

async function hashMatches(
  workspaceId: string,
  operation: SyncOperation
): Promise<boolean> {
  try {
    const expected = await payloadHash({
      opId: operation.opId,
      workspaceId,
      entityType: operation.entityType,
      entityId: operation.entityId,
      operation: operation.operation,
      fieldPatches: operation.fieldPatches,
    });

    return expected === operation.payloadHash;
  } catch (error) {
    throw new SyncServiceError(
      400,
      "invalid_operation",
      "The operation payload is not valid.",
      { cause: error }
    );
  }
}

function readSnapshot(
  sqlite: DatabaseSync,
  workspaceId: string,
  entityType: SyncEntityType,
  entityId: string
): EntitySnapshot | null {
  switch (entityType) {
    case "workspace": {
      const row = sqlite
        .prepare("SELECT name, created_at, updated_at FROM workspaces WHERE id = ?")
        .get(entityId) as
        { name: string; created_at: string; updated_at: string } | undefined;

      return row === undefined
        ? null
        : {
            values: {
              name: row.name,
              createdAt: row.created_at,
              updatedAt: row.updated_at,
            },
            tagIds: [],
            targetNoteIds: [],
          };
    }
    case "folder": {
      const row = sqlite
        .prepare(
          `SELECT name, parent_id, created_at, updated_at FROM folders
           WHERE id = ? AND workspace_id = ?`
        )
        .get(entityId, workspaceId) as
        | {
            name: string;
            parent_id: string | null;
            created_at: string;
            updated_at: string;
          }
        | undefined;

      return row === undefined
        ? null
        : {
            values: {
              name: row.name,
              parentId: row.parent_id,
              createdAt: row.created_at,
              updatedAt: row.updated_at,
            },
            tagIds: [],
            targetNoteIds: [],
          };
    }
    case "file": {
      const row = sqlite
        .prepare(
          `SELECT name, folder_id, mime_type, size_bytes, blob_key, checksum,
                  created_at, updated_at
           FROM files WHERE id = ? AND workspace_id = ?`
        )
        .get(entityId, workspaceId) as
        | {
            name: string;
            folder_id: string | null;
            mime_type: string | null;
            size_bytes: number;
            blob_key: string;
            checksum: string | null;
            created_at: string;
            updated_at: string;
          }
        | undefined;

      if (row === undefined) {
        return null;
      }

      const tags = sqlite
        .prepare("SELECT tag_id FROM file_tags WHERE file_id = ? ORDER BY tag_id")
        .all(entityId) as Array<{ tag_id: string }>;

      return {
        values: {
          name: row.name,
          folderId: row.folder_id,
          mimeType: row.mime_type,
          sizeBytes: row.size_bytes,
          blobKey: row.blob_key,
          checksum: row.checksum,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        },
        tagIds: tags.map((tag) => tag.tag_id),
        targetNoteIds: [],
      };
    }
    case "note": {
      const row = sqlite
        .prepare(
          `SELECT title, content, pinned, folder_id, created_at, updated_at
           FROM notes WHERE id = ? AND workspace_id = ?`
        )
        .get(entityId, workspaceId) as
        | {
            title: string;
            content: string;
            pinned: number;
            folder_id: string | null;
            created_at: string;
            updated_at: string;
          }
        | undefined;

      if (row === undefined) {
        return null;
      }

      const tags = sqlite
        .prepare("SELECT tag_id FROM note_tags WHERE note_id = ? ORDER BY tag_id")
        .all(entityId) as Array<{ tag_id: string }>;
      const links = sqlite
        .prepare(
          "SELECT target_note_id FROM note_links WHERE source_note_id = ? ORDER BY target_note_id"
        )
        .all(entityId) as Array<{ target_note_id: string }>;

      return {
        values: {
          title: row.title,
          content: row.content,
          pinned: row.pinned !== 0,
          folderId: row.folder_id,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        },
        tagIds: tags.map((tag) => tag.tag_id),
        targetNoteIds: links.map((link) => link.target_note_id),
      };
    }
    case "tag": {
      const row = sqlite
        .prepare(
          "SELECT name, color, created_at FROM tags WHERE id = ? AND workspace_id = ?"
        )
        .get(entityId, workspaceId) as
        { name: string; color: string | null; created_at: string } | undefined;

      return row === undefined
        ? null
        : {
            values: {
              name: row.name,
              color: row.color,
              createdAt: row.created_at,
            },
            tagIds: [],
            targetNoteIds: [],
          };
    }
  }
}

function currentFieldValue(snapshot: EntitySnapshot, fieldPath: string): unknown {
  if (fieldPath === "tagIds") {
    return snapshot.tagIds;
  }

  if (fieldPath === "targetNoteIds") {
    return snapshot.targetNoteIds;
  }

  return snapshot.values[fieldPath];
}

function assertRowExists(
  sqlite: DatabaseSync,
  table: "folders" | "notes" | "tags",
  id: string,
  workspaceId: string,
  label: string
): void {
  const row = sqlite
    .prepare(`SELECT 1 AS present FROM ${table} WHERE id = ? AND workspace_id = ?`)
    .get(id, workspaceId);

  if (row === undefined) {
    throw invalid(`The ${label} does not exist.`);
  }
}

function assertFolderParent(
  sqlite: DatabaseSync,
  workspaceId: string,
  entityId: string,
  parentId: string | null
): void {
  if (parentId === null) {
    return;
  }

  if (parentId === entityId) {
    throw invalid("A folder must not be its own parent.");
  }

  let current: string | null = parentId;

  for (let depth = 0; depth < 1024 && current !== null; depth += 1) {
    const row = sqlite
      .prepare("SELECT parent_id FROM folders WHERE id = ? AND workspace_id = ?")
      .get(current, workspaceId) as { parent_id: string | null } | undefined;

    if (row === undefined) {
      throw invalid("The parent folder does not exist.");
    }

    if (row.parent_id === entityId) {
      throw invalid("A folder must not move inside one of its descendants.");
    }

    current = row.parent_id;
  }

  if (current !== null) {
    throw invalid("The folder hierarchy is too deep.");
  }
}

function validateReferences(
  sqlite: DatabaseSync,
  workspaceId: string,
  entityType: SyncEntityType,
  entityId: string,
  patches: Record<string, unknown>
): void {
  if (entityType === "note") {
    if (patches.folderId !== undefined && patches.folderId !== null) {
      assertRowExists(
        sqlite,
        "folders",
        patches.folderId as string,
        workspaceId,
        "folder"
      );
    }

    if (patches.tagIds !== undefined) {
      for (const tagId of patches.tagIds as string[]) {
        assertRowExists(sqlite, "tags", tagId, workspaceId, "tag");
      }
    }

    if (patches.targetNoteIds !== undefined) {
      for (const targetId of patches.targetNoteIds as string[]) {
        if (targetId === entityId) {
          throw invalid("A note must not link to itself.");
        }

        assertRowExists(sqlite, "notes", targetId, workspaceId, "target note");
      }
    }
  }

  if (entityType === "file") {
    if (patches.folderId !== undefined && patches.folderId !== null) {
      assertRowExists(
        sqlite,
        "folders",
        patches.folderId as string,
        workspaceId,
        "folder"
      );
    }

    if (patches.tagIds !== undefined) {
      for (const tagId of patches.tagIds as string[]) {
        assertRowExists(sqlite, "tags", tagId, workspaceId, "tag");
      }
    }
  }

  if (entityType === "folder" && patches.parentId !== undefined) {
    assertFolderParent(sqlite, workspaceId, entityId, patches.parentId as string | null);
  }

  if (entityType === "tag" && patches.name !== undefined) {
    const duplicate = sqlite
      .prepare(
        "SELECT 1 AS present FROM tags WHERE workspace_id = ? AND name = ? AND id <> ?"
      )
      .get(workspaceId, patches.name as string, entityId);

    if (duplicate !== undefined) {
      throw invalid("A tag with that name already exists.");
    }
  }
}

function laterTimestamp(existing: unknown, next: string): string {
  return typeof existing === "string" && existing > next ? existing : next;
}

function replaceTags(
  sqlite: DatabaseSync,
  table: "file_tags" | "note_tags",
  ownerColumn: "file_id" | "note_id",
  ownerId: string,
  tagIds: string[]
): void {
  sqlite.prepare(`DELETE FROM ${table} WHERE ${ownerColumn} = ?`).run(ownerId);
  const insert = sqlite.prepare(
    `INSERT INTO ${table} (${ownerColumn}, tag_id) VALUES (?, ?)`
  );

  for (const tagId of tagIds) {
    insert.run(ownerId, tagId);
  }
}

function replaceNoteLinks(
  sqlite: DatabaseSync,
  sourceNoteId: string,
  targetNoteIds: string[]
): void {
  sqlite.prepare("DELETE FROM note_links WHERE source_note_id = ?").run(sourceNoteId);
  const insert = sqlite.prepare(
    "INSERT INTO note_links (source_note_id, target_note_id) VALUES (?, ?)"
  );

  for (const targetId of targetNoteIds) {
    insert.run(sourceNoteId, targetId);
  }
}

function updateRow(
  sqlite: DatabaseSync,
  table: "folders" | "files" | "notes" | "tags",
  id: string,
  workspaceId: string,
  assignments: string[],
  values: SqlValue[]
): void {
  const result = sqlite
    .prepare(
      `UPDATE ${table} SET ${assignments.join(", ")}
       WHERE id = ? AND workspace_id = ?`
    )
    .run(...values, id, workspaceId);

  if (Number(result.changes) === 0) {
    throw invalid("The entity does not exist.");
  }
}

function updateNote(
  sqlite: DatabaseSync,
  workspaceId: string,
  noteId: string,
  patches: Record<string, unknown>,
  appliedAt: string
): void {
  const assignments: string[] = [];
  const values: SqlValue[] = [];

  if (patches.title !== undefined) {
    assignments.push("title = ?");
    values.push(patches.title as string);
  }

  if (patches.content !== undefined) {
    assignments.push("content = ?");
    values.push(patches.content as string);
  }

  if (patches.pinned !== undefined) {
    assignments.push("pinned = ?");
    values.push(patches.pinned === true ? 1 : 0);
  }

  if (patches.folderId !== undefined) {
    assignments.push("folder_id = ?");
    values.push(patches.folderId as string | null);
  }

  const row = sqlite
    .prepare("SELECT updated_at FROM notes WHERE id = ? AND workspace_id = ?")
    .get(noteId, workspaceId) as { updated_at: string } | undefined;

  assignments.push("updated_at = ?");
  values.push(laterTimestamp(row?.updated_at, appliedAt));
  updateRow(sqlite, "notes", noteId, workspaceId, assignments, values);

  if (patches.tagIds !== undefined) {
    replaceTags(sqlite, "note_tags", "note_id", noteId, patches.tagIds as string[]);
  }

  if (patches.targetNoteIds !== undefined) {
    replaceNoteLinks(sqlite, noteId, patches.targetNoteIds as string[]);
  }
}

function updateFolder(
  sqlite: DatabaseSync,
  workspaceId: string,
  folderId: string,
  patches: Record<string, unknown>,
  appliedAt: string
): void {
  const assignments: string[] = [];
  const values: SqlValue[] = [];

  if (patches.name !== undefined) {
    assignments.push("name = ?");
    values.push(patches.name as string);
  }

  if (patches.parentId !== undefined) {
    assignments.push("parent_id = ?");
    values.push(patches.parentId as string | null);
  }

  const row = sqlite
    .prepare("SELECT updated_at FROM folders WHERE id = ? AND workspace_id = ?")
    .get(folderId, workspaceId) as { updated_at: string } | undefined;

  assignments.push("updated_at = ?");
  values.push(laterTimestamp(row?.updated_at, appliedAt));
  updateRow(sqlite, "folders", folderId, workspaceId, assignments, values);
}

function updateFile(
  sqlite: DatabaseSync,
  workspaceId: string,
  fileId: string,
  patches: Record<string, unknown>,
  appliedAt: string
): void {
  const assignments: string[] = [];
  const values: SqlValue[] = [];

  if (patches.name !== undefined) {
    assignments.push("name = ?");
    values.push(patches.name as string);
  }

  if (patches.folderId !== undefined) {
    assignments.push("folder_id = ?");
    values.push(patches.folderId as string | null);
  }

  const row = sqlite
    .prepare("SELECT updated_at FROM files WHERE id = ? AND workspace_id = ?")
    .get(fileId, workspaceId) as { updated_at: string } | undefined;

  assignments.push("updated_at = ?");
  values.push(laterTimestamp(row?.updated_at, appliedAt));
  updateRow(sqlite, "files", fileId, workspaceId, assignments, values);

  if (patches.tagIds !== undefined) {
    replaceTags(sqlite, "file_tags", "file_id", fileId, patches.tagIds as string[]);
  }
}

function updateTag(
  sqlite: DatabaseSync,
  workspaceId: string,
  tagId: string,
  patches: Record<string, unknown>
): void {
  const assignments: string[] = [];
  const values: SqlValue[] = [];

  if (patches.name !== undefined) {
    assignments.push("name = ?");
    values.push(patches.name as string);
  }

  if (patches.color !== undefined) {
    assignments.push("color = ?");
    values.push(patches.color as string | null);
  }

  updateRow(sqlite, "tags", tagId, workspaceId, assignments, values);
}

function updateWorkspace(
  sqlite: DatabaseSync,
  workspaceId: string,
  patches: Record<string, unknown>,
  appliedAt: string
): void {
  const assignments: string[] = [];
  const values: SqlValue[] = [];

  if (patches.name !== undefined) {
    assignments.push("name = ?");
    values.push(patches.name as string);
  }

  const row = sqlite
    .prepare("SELECT updated_at FROM workspaces WHERE id = ?")
    .get(workspaceId) as { updated_at: string } | undefined;

  assignments.push("updated_at = ?");
  values.push(laterTimestamp(row?.updated_at, appliedAt));

  const result = sqlite
    .prepare(`UPDATE workspaces SET ${assignments.join(", ")} WHERE id = ?`)
    .run(...values, workspaceId);

  if (Number(result.changes) === 0) {
    throw invalid("The workspace does not exist.");
  }
}

function createNote(
  sqlite: DatabaseSync,
  workspaceId: string,
  noteId: string,
  patches: Record<string, unknown>,
  appliedAt: string
): void {
  sqlite
    .prepare(
      `INSERT INTO notes (
        id, workspace_id, folder_id, title, content, pinned, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      noteId,
      workspaceId,
      (patches.folderId as string | null | undefined) ?? null,
      patches.title as string,
      (patches.content as string | undefined) ?? "",
      patches.pinned === true ? 1 : 0,
      appliedAt,
      appliedAt
    );

  replaceTags(
    sqlite,
    "note_tags",
    "note_id",
    noteId,
    (patches.tagIds as string[] | undefined) ?? []
  );
  replaceNoteLinks(sqlite, noteId, (patches.targetNoteIds as string[] | undefined) ?? []);
}

function createFolder(
  sqlite: DatabaseSync,
  workspaceId: string,
  folderId: string,
  patches: Record<string, unknown>,
  appliedAt: string
): void {
  sqlite
    .prepare(
      `INSERT INTO folders (
        id, workspace_id, parent_id, name, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      folderId,
      workspaceId,
      (patches.parentId as string | null | undefined) ?? null,
      patches.name as string,
      appliedAt,
      appliedAt
    );
}

function createFile(
  sqlite: DatabaseSync,
  workspaceId: string,
  fileId: string,
  patches: Record<string, unknown>,
  appliedAt: string
): void {
  sqlite
    .prepare(
      `INSERT INTO files (
        id, workspace_id, folder_id, name, mime_type, size_bytes, blob_key,
        checksum, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      fileId,
      workspaceId,
      (patches.folderId as string | null | undefined) ?? null,
      patches.name as string,
      (patches.mimeType as string | null | undefined) ?? null,
      patches.sizeBytes as number,
      patches.blobKey as string,
      (patches.checksum as string | null | undefined) ?? null,
      appliedAt,
      appliedAt
    );

  replaceTags(
    sqlite,
    "file_tags",
    "file_id",
    fileId,
    (patches.tagIds as string[] | undefined) ?? []
  );
}

function createTag(
  sqlite: DatabaseSync,
  workspaceId: string,
  tagId: string,
  patches: Record<string, unknown>,
  appliedAt: string
): void {
  sqlite
    .prepare(
      `INSERT INTO tags (id, workspace_id, name, color, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      tagId,
      workspaceId,
      patches.name as string,
      (patches.color as string | null | undefined) ?? null,
      appliedAt
    );
}

function deleteEntity(
  sqlite: DatabaseSync,
  workspaceId: string,
  entityType: Exclude<SyncEntityType, "workspace">,
  entityId: string
): void {
  const tables: Record<Exclude<SyncEntityType, "workspace">, string> = {
    folder: "folders",
    file: "files",
    note: "notes",
    tag: "tags",
  };
  const result = sqlite
    .prepare(`DELETE FROM ${tables[entityType]} WHERE id = ? AND workspace_id = ?`)
    .run(entityId, workspaceId);

  if (Number(result.changes) === 0) {
    throw invalid("The entity does not exist.");
  }
}

function applyEntityChange(
  sqlite: DatabaseSync,
  workspaceId: string,
  entityType: SyncEntityType,
  entityId: string,
  operation: SyncOperationType,
  patches: Record<string, unknown>,
  snapshot: EntitySnapshot | null,
  appliedAt: string
): void {
  if (operation === "delete") {
    if (entityType === "workspace") {
      throw invalid("A workspace cannot be deleted through sync.");
    }

    deleteEntity(sqlite, workspaceId, entityType, entityId);
    return;
  }

  const creating =
    operation === "create" || (operation === "restore" && snapshot === null);

  if (creating) {
    switch (entityType) {
      case "workspace":
        throw invalid("A workspace cannot be created through sync.");
      case "folder":
        createFolder(sqlite, workspaceId, entityId, patches, appliedAt);
        return;
      case "file":
        createFile(sqlite, workspaceId, entityId, patches, appliedAt);
        return;
      case "note":
        createNote(sqlite, workspaceId, entityId, patches, appliedAt);
        return;
      case "tag":
        createTag(sqlite, workspaceId, entityId, patches, appliedAt);
        return;
    }
  }

  switch (entityType) {
    case "workspace":
      updateWorkspace(sqlite, workspaceId, patches, appliedAt);
      return;
    case "folder":
      updateFolder(sqlite, workspaceId, entityId, patches, appliedAt);
      return;
    case "file":
      updateFile(sqlite, workspaceId, entityId, patches, appliedAt);
      return;
    case "note":
      updateNote(sqlite, workspaceId, entityId, patches, appliedAt);
      return;
    case "tag":
      updateTag(sqlite, workspaceId, entityId, patches);
      return;
  }
}

function detectConflict(
  sqlite: DatabaseSync,
  workspaceId: string,
  operation: SyncOperation,
  fieldPath: string,
  existingRevision: number,
  existingValue: unknown,
  incomingValue: unknown,
  appliedAt: string
): StoredConflict | null {
  if (
    operation.operation !== "update" ||
    existingRevision <= operation.baseEntityRevision ||
    isDeepStrictEqual(existingValue, incomingValue) ||
    fieldClass(operation.entityType, fieldPath) === "merge-safe"
  ) {
    return null;
  }

  const localOpId =
    findLastAppliedFieldOperation(
      sqlite,
      workspaceId,
      operation.entityType,
      operation.entityId,
      fieldPath
    ) ?? operation.opId;

  return {
    conflictId: generateId(),
    entityType: operation.entityType,
    entityId: operation.entityId,
    fieldPath,
    localFieldRevision: existingRevision,
    remoteFieldRevision: existingRevision + 1,
    localOpId,
    remoteOpId: operation.opId,
    localValue: existingValue as SyncConflict["localValue"],
    remoteValue: incomingValue as SyncConflict["localValue"],
    localDeviceId: operation.deviceId,
    remoteDeviceId: operation.deviceId,
    createdAt: appliedAt as IsoDate,
    resolution: "remote",
  };
}

function applyOperation(
  sqlite: DatabaseSync,
  request: PushRequest,
  operation: SyncOperation,
  appliedAt: string
): ApplyOutcome {
  const workspaceId = request.workspaceId;
  const entityType = operation.entityType;
  const entityId = operation.entityId;
  const existingMeta = readEntityMeta(sqlite, workspaceId, entityType, entityId);
  const tombstone = readTombstone(sqlite, workspaceId, entityType, entityId);

  if (operation.operation !== "restore" && tombstone !== null) {
    throw new SyncServiceError(
      409,
      "tombstoned_entity",
      "The entity is deleted and must be restored explicitly."
    );
  }

  if (operation.operation === "restore" && tombstone === null) {
    throw invalid("The entity is not deleted.");
  }

  if (operation.operation === "create" && operation.baseEntityRevision !== 0) {
    throw invalid("A create operation must start at revision 0.");
  }

  if (
    operation.operation !== "create" &&
    existingMeta !== null &&
    operation.baseEntityRevision > existingMeta.entityRevision
  ) {
    throw invalid("The base entity revision is ahead of the server.");
  }

  if (
    entityType === "workspace" &&
    (operation.operation !== "update" || entityId !== workspaceId)
  ) {
    throw invalid("A workspace can only be updated through sync.");
  }

  const snapshot = readSnapshot(sqlite, workspaceId, entityType, entityId);

  if (operation.operation === "create" && snapshot !== null) {
    throw invalid("The entity already exists.");
  }

  if (
    (operation.operation === "update" || operation.operation === "delete") &&
    snapshot === null
  ) {
    throw invalid("The entity does not exist.");
  }

  if (operation.operation === "restore" && entityType === "workspace") {
    throw invalid("A workspace cannot be restored through sync.");
  }

  const patches = normalizePatches(
    entityType,
    operation.operation,
    operation.fieldPatches
  );

  validateReferences(sqlite, workspaceId, entityType, entityId, patches);

  if (
    (operation.operation === "create" ||
      (operation.operation === "restore" && snapshot === null)) &&
    entityType !== "workspace"
  ) {
    assertRequired(entityType, patches);
  }

  const fieldRevisions: Record<string, number> = {};
  const conflicts: StoredConflict[] = [];

  for (const fieldPath of Object.keys(patches)) {
    const existingField = readFieldMeta(
      sqlite,
      workspaceId,
      entityType,
      entityId,
      fieldPath
    );
    const existingRevision = existingField?.fieldRevision ?? 0;
    fieldRevisions[fieldPath] = existingRevision + 1;

    if (snapshot !== null) {
      const conflict = detectConflict(
        sqlite,
        workspaceId,
        operation,
        fieldPath,
        existingRevision,
        currentFieldValue(snapshot, fieldPath),
        patches[fieldPath],
        appliedAt
      );

      if (conflict !== null) {
        const localDeviceId = existingMeta?.originDeviceId ?? operation.deviceId;
        conflicts.push({
          ...conflict,
          localDeviceId,
          remoteDeviceId: operation.deviceId,
        });
      }
    }
  }

  applyEntityChange(
    sqlite,
    workspaceId,
    entityType,
    entityId,
    operation.operation,
    patches,
    snapshot,
    appliedAt
  );

  const canonicalRevision = readAuthorityRevision(sqlite, workspaceId) + 1;
  const entityRevision = (existingMeta?.entityRevision ?? 0) + 1;
  const deletedAt = operation.operation === "delete" ? appliedAt : null;

  writeEntityMeta(sqlite, {
    workspaceId,
    entityType,
    entityId,
    entityRevision,
    workspaceRevision: canonicalRevision,
    originDeviceId: operation.deviceId,
    updatedAt: appliedAt,
    deletedAt,
    contentHash: null,
  });

  for (const [fieldPath, fieldRevision] of Object.entries(fieldRevisions)) {
    writeFieldMeta(sqlite, {
      workspaceId,
      entityType,
      entityId,
      fieldPath,
      fieldRevision,
      workspaceRevision: canonicalRevision,
      originDeviceId: operation.deviceId,
      updatedAt: appliedAt,
      deletedAt: null,
    });
  }

  if (operation.operation === "delete") {
    markEntityFieldsDeleted(sqlite, workspaceId, entityType, entityId, appliedAt);
    writeTombstone(sqlite, {
      tombstoneId: generateId(),
      workspaceId,
      entityType,
      entityId,
      deletedAt: appliedAt,
      deletedByDeviceId: operation.deviceId,
      tombstoneWorkspaceRevision: canonicalRevision,
      state: "active",
      compactedAt: null,
    });
  }

  if (operation.operation === "restore") {
    clearEntityFieldsDeleted(sqlite, workspaceId, entityType, entityId);
    deleteTombstone(sqlite, workspaceId, entityType, entityId);
  }

  for (const conflict of conflicts) {
    insertConflict(sqlite, workspaceId, conflict);
  }

  writeAuthorityRevision(sqlite, workspaceId, canonicalRevision, appliedAt);

  const record: AppliedOperationRecord = {
    opId: operation.opId,
    workspaceId,
    deviceId: operation.deviceId,
    entityType,
    entityId,
    operation: operation.operation,
    baseEntityRevision: operation.baseEntityRevision,
    baseWorkspaceRevision: operation.baseWorkspaceRevision,
    fieldPatches: patches,
    payloadHash: operation.payloadHash,
    localSequence: operation.localSequence,
    createdAt: operation.createdAt,
    canonicalRevision,
    appliedAt,
    entityRevision,
    fieldRevisions,
  };

  insertAppliedOperation(sqlite, record);

  return { operation: record, conflicts };
}

function toProtocolConflict(conflict: StoredConflict): SyncConflict {
  return {
    conflictId: conflict.conflictId,
    entityType: conflict.entityType,
    entityId: conflict.entityId,
    fieldPath: conflict.fieldPath,
    localOpId: conflict.localOpId,
    remoteOpId: conflict.remoteOpId,
    localFieldRevision: conflict.localFieldRevision,
    remoteFieldRevision: conflict.remoteFieldRevision,
    localValue: conflict.localValue,
    remoteValue: conflict.remoteValue,
    localDeviceId: conflict.localDeviceId,
    remoteDeviceId: conflict.remoteDeviceId,
    createdAt: conflict.createdAt,
  };
}

function toAppliedResult(
  record: AppliedOperationRecord,
  replayed: boolean
): PushResponse["applied"][number] {
  return {
    opId: record.opId as PushResponse["applied"][number]["opId"],
    canonicalRevision: record.canonicalRevision,
    entityRevision: record.entityRevision,
    fieldRevisions: record.fieldRevisions,
    replayed,
    appliedAt: record.appliedAt as IsoDate,
  };
}

function toPullOperation(record: AppliedOperationRecord): AppliedOperation {
  return {
    opId: record.opId as AppliedOperation["opId"],
    entityType: record.entityType,
    entityId: record.entityId as AppliedOperation["entityId"],
    operation: record.operation,
    baseEntityRevision: record.baseEntityRevision,
    baseWorkspaceRevision: record.baseWorkspaceRevision,
    fieldPatches: record.fieldPatches,
    payloadHash: record.payloadHash as AppliedOperation["payloadHash"],
    deviceId: record.deviceId as AppliedOperation["deviceId"],
    localSequence: record.localSequence,
    createdAt: record.createdAt as IsoDate,
    canonicalRevision: record.canonicalRevision,
  };
}

function encodeCursor(workspaceId: string, revision: number): string {
  return Buffer.from(`${CURSOR_VERSION}:${workspaceId}:${revision}`, "utf8").toString(
    "base64url"
  );
}

function decodeCursor(
  sqlite: DatabaseSync,
  workspaceId: string,
  cursor: string | null
): number {
  if (cursor === null) {
    return 0;
  }

  if (cursor.length > MAX_SYNC_CURSOR_LENGTH || !CURSOR_PATTERN.test(cursor)) {
    throw invalid("The sync cursor is not valid.", "invalid_cursor");
  }

  const decoded = Buffer.from(cursor, "base64url").toString("utf8");
  const [version, cursorWorkspaceId, rawRevision] = decoded.split(":");

  if (
    version !== CURSOR_VERSION ||
    cursorWorkspaceId !== workspaceId ||
    rawRevision === undefined ||
    !/^(0|[1-9][0-9]*)$/.test(rawRevision)
  ) {
    throw invalid("The sync cursor is not valid.", "invalid_cursor");
  }

  const revision = Number(rawRevision);
  const authority = readAuthorityRevision(sqlite, workspaceId);

  if (!Number.isSafeInteger(revision) || revision < 0 || revision > authority) {
    throw invalid("The sync cursor is not valid.", "invalid_cursor");
  }

  return revision;
}

function rejectNonReplayedHash(matches: boolean, operation: SyncOperation): void {
  if (!matches) {
    throw new SyncServiceError(
      400,
      "invalid_payload_hash",
      `The payload hash for ${operation.opId} does not match.`
    );
  }
}

export function createSyncService(options: CreateSyncServiceOptions): SyncService {
  const { store } = options;
  const now = options.now ?? (() => new Date());
  const sqlite = store.sqlite;

  return {
    async push(request, actor) {
      requireWriteRole(actor);
      assertWorkspace(sqlite, request.workspaceId);

      if (request.operations.length === 0) {
        throw invalid("A push batch must contain at least one operation.");
      }

      if (request.operations.length > MAX_SYNC_BATCH_OPERATIONS) {
        throw invalid("The push batch is too large.");
      }

      const deviceId = request.operations[0]?.deviceId;

      for (const operation of request.operations) {
        if (operation.deviceId !== deviceId) {
          throw invalid("A push batch must come from one device.");
        }
      }

      const hashMatchesByOperation = await Promise.all(
        request.operations.map((operation) => hashMatches(request.workspaceId, operation))
      );
      const appliedAt = now().toISOString();
      const applied: PushResponse["applied"] = [];
      const conflicts: SyncConflict[] = [];

      store.transaction(() => {
        request.operations.forEach((operation, index) => {
          const existing = readAppliedOperation(sqlite, operation.opId);

          if (existing !== null) {
            if (existing.workspaceId !== request.workspaceId) {
              throw new SyncServiceError(
                409,
                "invalid_sync_state",
                "The operation belongs to another workspace."
              );
            }

            applied.push(toAppliedResult(existing, true));

            for (const conflict of listConflictsForOperation(
              sqlite,
              request.workspaceId,
              operation.opId
            )) {
              conflicts.push(toProtocolConflict(conflict));
            }

            return;
          }

          rejectNonReplayedHash(hashMatchesByOperation[index] ?? false, operation);

          const outcome = applyOperation(sqlite, request, operation, appliedAt);
          applied.push(toAppliedResult(outcome.operation, false));

          for (const conflict of outcome.conflicts) {
            conflicts.push(toProtocolConflict(conflict));
          }
        });
      });

      return {
        protocolVersion: SYNC_PROTOCOL_VERSION,
        workspaceId: request.workspaceId,
        applied,
        conflicts,
        rejected: [],
      };
    },

    async pull(request, actor) {
      requireReadRole(actor);
      assertWorkspace(sqlite, request.workspaceId);

      if (
        !Number.isInteger(request.limit) ||
        request.limit < 1 ||
        request.limit > MAX_SYNC_PULL_OPERATIONS
      ) {
        throw invalid("The pull limit is not valid.");
      }

      const afterRevision = decodeCursor(sqlite, request.workspaceId, request.cursor);
      const rows = listAppliedOperations(
        sqlite,
        request.workspaceId,
        afterRevision,
        request.limit + 1
      );
      const hasMore = rows.length > request.limit;
      const page = rows.slice(0, request.limit);
      const last = page[page.length - 1];

      return {
        protocolVersion: SYNC_PROTOCOL_VERSION,
        workspaceId: request.workspaceId,
        operations: page.map(toPullOperation),
        nextCursor:
          hasMore && last !== undefined
            ? (encodeCursor(
                request.workspaceId,
                last.canonicalRevision
              ) as PullResponse["nextCursor"])
            : null,
      };
    },
  };
}
