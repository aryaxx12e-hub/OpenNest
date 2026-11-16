import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";

export const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const folders = sqliteTable(
  "folders",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    parentId: text("parent_id").references((): AnySQLiteColumn => folders.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("folders_workspace_idx").on(table.workspaceId),
    index("folders_workspace_parent_idx").on(table.workspaceId, table.parentId),
    index("folders_workspace_created_idx").on(table.workspaceId, table.createdAt),
    index("folders_workspace_updated_idx").on(table.workspaceId, table.updatedAt),
  ]
);

export const files = sqliteTable(
  "files",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    folderId: text("folder_id").references(() => folders.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    mimeType: text("mime_type"),
    sizeBytes: integer("size_bytes").notNull().default(0),
    blobKey: text("blob_key").notNull(),
    checksum: text("checksum"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("files_workspace_idx").on(table.workspaceId),
    index("files_workspace_folder_idx").on(table.workspaceId, table.folderId),
    index("files_workspace_created_idx").on(table.workspaceId, table.createdAt),
    index("files_workspace_updated_idx").on(table.workspaceId, table.updatedAt),
  ]
);

export const notes = sqliteTable(
  "notes",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    folderId: text("folder_id").references(() => folders.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    content: text("content").notNull().default(""),
    pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("notes_workspace_idx").on(table.workspaceId),
    index("notes_workspace_folder_idx").on(table.workspaceId, table.folderId),
    index("notes_workspace_created_idx").on(table.workspaceId, table.createdAt),
    index("notes_workspace_updated_idx").on(table.workspaceId, table.updatedAt),
  ]
);

export const tags = sqliteTable(
  "tags",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("tags_workspace_name_uq").on(table.workspaceId, table.name),
    index("tags_workspace_created_idx").on(table.workspaceId, table.createdAt),
  ]
);

export const fileTags = sqliteTable(
  "file_tags",
  {
    fileId: text("file_id")
      .notNull()
      .references(() => files.id, { onDelete: "cascade" }),
    tagId: text("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.fileId, table.tagId] }),
    index("file_tags_tag_idx").on(table.tagId),
  ]
);

export const noteTags = sqliteTable(
  "note_tags",
  {
    noteId: text("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    tagId: text("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.noteId, table.tagId] }),
    index("note_tags_tag_idx").on(table.tagId),
  ]
);

export const noteLinks = sqliteTable(
  "note_links",
  {
    sourceNoteId: text("source_note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    targetNoteId: text("target_note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.sourceNoteId, table.targetNoteId] }),
    index("note_links_target_idx").on(table.targetNoteId),
  ]
);

export const syncMeta = sqliteTable(
  "sync_meta",
  {
    workspaceId: text("workspace_id").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    entityRevision: integer("entity_revision").notNull(),
    workspaceRevision: integer("workspace_revision").notNull(),
    originDeviceId: text("origin_device_id").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
    contentHash: text("content_hash"),
  },
  (table) => [
    primaryKey({
      columns: [table.workspaceId, table.entityType, table.entityId],
    }),
    index("sync_meta_workspace_revision_idx").on(
      table.workspaceId,
      table.workspaceRevision
    ),
  ]
);

export const syncFieldMeta = sqliteTable(
  "sync_field_meta",
  {
    workspaceId: text("workspace_id").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    fieldPath: text("field_path").notNull(),
    fieldRevision: integer("field_revision").notNull(),
    workspaceRevision: integer("workspace_revision").notNull(),
    originDeviceId: text("origin_device_id").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    primaryKey({
      columns: [table.workspaceId, table.entityType, table.entityId, table.fieldPath],
    }),
    index("sync_field_meta_entity_idx").on(
      table.workspaceId,
      table.entityType,
      table.entityId
    ),
  ]
);

export const syncOutbox = sqliteTable(
  "sync_outbox",
  {
    opId: text("op_id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    operation: text("operation").notNull(),
    baseEntityRevision: integer("base_entity_revision").notNull(),
    baseWorkspaceRevision: integer("base_workspace_revision").notNull(),
    fieldPatches: text("field_patches").notNull(),
    payloadHash: text("payload_hash").notNull(),
    createdAt: text("created_at").notNull(),
    deviceId: text("device_id").notNull(),
    localSequence: integer("local_sequence").notNull(),
    attempts: integer("attempts").notNull().default(0),
    state: text("state").notNull(),
    ackedAt: text("acked_at"),
  },
  (table) => [
    uniqueIndex("sync_outbox_workspace_device_sequence_uq").on(
      table.workspaceId,
      table.deviceId,
      table.localSequence
    ),
    index("sync_outbox_workspace_device_state_sequence_idx").on(
      table.workspaceId,
      table.deviceId,
      table.state,
      table.localSequence
    ),
  ]
);

export const workspaceSyncState = sqliteTable(
  "workspace_sync_state",
  {
    workspaceId: text("workspace_id").notNull(),
    deviceId: text("device_id").notNull(),
    remoteWorkspaceId: text("remote_workspace_id"),
    lastServerCursor: text("last_server_cursor"),
    lastLocalWorkspaceRevision: integer("last_local_workspace_revision").notNull(),
    lastLocalSequence: integer("last_local_sequence").notNull().default(0),
    tombstoneFloor: integer("tombstone_floor").notNull(),
    lastFullResyncAt: text("last_full_resync_at"),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.deviceId] })]
);

export const syncTombstone = sqliteTable(
  "sync_tombstone",
  {
    tombstoneId: text("tombstone_id").notNull(),
    workspaceId: text("workspace_id").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    deletedAt: text("deleted_at").notNull(),
    deletedByDeviceId: text("deleted_by_device_id").notNull(),
    tombstoneWorkspaceRevision: integer("tombstone_workspace_revision").notNull(),
    state: text("state").notNull(),
    compactedAt: text("compacted_at"),
  },
  (table) => [
    primaryKey({
      columns: [table.workspaceId, table.entityType, table.entityId],
    }),
    index("sync_tombstone_workspace_revision_idx").on(
      table.workspaceId,
      table.tombstoneWorkspaceRevision
    ),
  ]
);

export const syncConflict = sqliteTable(
  "sync_conflict",
  {
    conflictId: text("conflict_id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    fieldPath: text("field_path").notNull(),
    localFieldRevision: integer("local_field_revision").notNull(),
    remoteFieldRevision: integer("remote_field_revision").notNull(),
    localOpId: text("local_op_id").notNull(),
    remoteOpId: text("remote_op_id").notNull(),
    localValue: text("local_value").notNull(),
    remoteValue: text("remote_value").notNull(),
    localDeviceId: text("local_device_id").notNull(),
    remoteDeviceId: text("remote_device_id").notNull(),
    createdAt: text("created_at").notNull(),
    state: text("state").notNull(),
    resolution: text("resolution"),
    resolvedAt: text("resolved_at"),
    resolvedByDeviceId: text("resolved_by_device_id"),
  },
  (table) => [
    index("sync_conflict_workspace_entity_state_idx").on(
      table.workspaceId,
      table.entityId,
      table.state
    ),
  ]
);

export const syncDevices = sqliteTable(
  "sync_devices",
  {
    workspaceId: text("workspace_id").notNull(),
    deviceId: text("device_id").notNull(),
    registeredAt: text("registered_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
    lastAckedTombstoneWorkspaceRevision: integer(
      "last_acked_tombstone_workspace_revision"
    ).notNull(),
    state: text("state").notNull(),
    publicKey: text("public_key"),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.deviceId] }),
    index("sync_devices_workspace_state_idx").on(table.workspaceId, table.state),
  ]
);
