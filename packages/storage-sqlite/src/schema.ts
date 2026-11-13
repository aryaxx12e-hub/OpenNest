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
