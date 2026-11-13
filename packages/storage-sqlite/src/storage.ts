import { DatabaseSync } from "node:sqlite";

import {
  ConstraintError,
  NotFoundError,
  StorageError,
  UnsupportedError,
  ValidationError,
  assertNoSelfLink,
  generateId,
  normalizeForSearch,
  normalizeTagName,
  searchTokens,
  toMatchQuery,
  type BackupSnapshot,
  type BlobKey,
  type FileId,
  type FileRepository,
  type Folder,
  type FolderId,
  type FolderRepository,
  type IsoDate,
  type Note,
  type NoteId,
  type NoteLink,
  type NoteRepository,
  type SearchHit,
  type SearchRepository,
  type SortField,
  type SqliteStorageConfig,
  type StoredFile,
  type StorageAdapter,
  type Tag,
  type TagId,
  type TagRepository,
  type Workspace,
  type WorkspaceId,
  type WorkspaceRepository,
} from "@opennest/core";
import { backupSnapshotSchema } from "@opennest/validation";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { FileSystemBlobStore } from "./blob-store";
import { openDatabase, type SqliteDatabase } from "./db";
import { mapSqliteError } from "./errors";
import { DEFAULT_LIMIT, mapPage, paginate } from "./pagination";
import { laterOf, requireAt } from "./repo-helpers";
import {
  fileTags as fileTagsTable,
  files as filesTable,
  folders as foldersTable,
  noteLinks as noteLinksTable,
  notes as notesTable,
  noteTags as noteTagsTable,
  tags as tagsTable,
  workspaces as workspacesTable,
} from "./schema";

const DEFAULT_WORKSPACE_NAME = "Workspace";

type WorkspaceRow = typeof workspacesTable.$inferSelect;
type FolderRow = typeof foldersTable.$inferSelect;
type FileRow = typeof filesTable.$inferSelect;
type NoteRow = typeof notesTable.$inferSelect;
type TagRow = typeof tagsTable.$inferSelect;

function toWorkspace(row: WorkspaceRow): Workspace {
  return {
    id: row.id as WorkspaceId,
    name: row.name,
    createdAt: row.createdAt as IsoDate,
    updatedAt: row.updatedAt as IsoDate,
  };
}

function toFolder(row: FolderRow): Folder {
  return {
    id: row.id as FolderId,
    workspaceId: row.workspaceId as WorkspaceId,
    parentId: row.parentId as FolderId | null,
    name: row.name,
    createdAt: row.createdAt as IsoDate,
    updatedAt: row.updatedAt as IsoDate,
  };
}

function toFile(row: FileRow): StoredFile {
  return {
    id: row.id as FileId,
    workspaceId: row.workspaceId as WorkspaceId,
    folderId: row.folderId as FolderId | null,
    name: row.name,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    blobKey: row.blobKey as BlobKey,
    checksum: row.checksum,
    createdAt: row.createdAt as IsoDate,
    updatedAt: row.updatedAt as IsoDate,
  };
}

function toNote(row: NoteRow): Note {
  return {
    id: row.id as NoteId,
    workspaceId: row.workspaceId as WorkspaceId,
    folderId: row.folderId as FolderId | null,
    title: row.title,
    content: row.content,
    pinned: row.pinned,
    createdAt: row.createdAt as IsoDate,
    updatedAt: row.updatedAt as IsoDate,
  };
}

function toTag(row: TagRow): Tag {
  return {
    id: row.id as TagId,
    workspaceId: row.workspaceId as WorkspaceId,
    name: row.name,
    color: row.color,
    createdAt: row.createdAt as IsoDate,
  };
}

function sortValueOf(
  sort: SortField,
  row: { name?: string; title?: string; createdAt: string; updatedAt?: string },
  isNote: boolean
): string {
  if (sort === "name") {
    return normalizeForSearch(isNote ? (row.title ?? "") : (row.name ?? ""));
  }

  return sort === "createdAt" ? row.createdAt : (row.updatedAt ?? row.createdAt);
}

function matchesTokens(text: string, tokens: string[]): boolean {
  const words = normalizeForSearch(text)
    .split(" ")
    .filter((word) => word.length > 0);

  return tokens.every((token) => words.some((word) => word.startsWith(token)));
}

function snippetOf(text: string, tokens: string[]): string {
  const folded = normalizeForSearch(text);
  const position = tokens
    .map((token) => folded.indexOf(token))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];

  if (position === undefined) {
    return text.slice(0, 80);
  }

  const start = Math.max(0, position - 20);

  return text.slice(start, start + 100);
}

function parseSnapshot(snapshot: BackupSnapshot): BackupSnapshot {
  const result = backupSnapshotSchema.safeParse(snapshot);

  if (!result.success) {
    throw new ValidationError(
      result.error.issues[0]?.message ?? "The snapshot is not valid.",
      { cause: result.error }
    );
  }

  return result.data;
}

export function createSqliteStorage(config: SqliteStorageConfig): StorageAdapter {
  const blobs = new FileSystemBlobStore({ rootDir: config.blobRoot });

  let connection: DatabaseSync | null = null;
  let db: SqliteDatabase | null = null;
  let closed = false;
  let schemaVersion = 0;
  let transactionDepth = 0;

  function guard(): void {
    if (closed || connection === null || db === null) {
      throw new StorageError("The storage adapter is closed.", "closed");
    }
  }

  function requireDb(): SqliteDatabase {
    guard();

    return db as SqliteDatabase;
  }

  async function run<T>(work: () => Promise<T>): Promise<T> {
    guard();

    try {
      return await work();
    } catch (error) {
      throw mapSqliteError(error);
    }
  }

  async function atomic<T>(work: () => Promise<T>): Promise<T> {
    if (transactionDepth > 0) {
      return work();
    }

    const sqlite = connection as DatabaseSync;
    sqlite.exec("BEGIN IMMEDIATE");

    try {
      const result = await work();
      sqlite.exec("COMMIT");

      return result;
    } catch (error) {
      try {
        sqlite.exec("ROLLBACK");
      } catch {
        // The transaction was already rolled back by SQLite.
      }

      throw error;
    }
  }

  async function subtreeIds(folderId: FolderId): Promise<string[]> {
    const rows = await requireDb().values<[unknown]>(sql`
      WITH RECURSIVE subtree(id) AS (
        SELECT id FROM folders WHERE id = ${folderId}
        UNION
        SELECT child.id FROM folders child JOIN subtree ON child.parent_id = subtree.id
      )
      SELECT id FROM subtree
    `);

    return rows.map((row) => String(row[0]));
  }

  async function fileTagIds(
    fileIds: readonly string[]
  ): Promise<Map<string, Set<string>>> {
    const owned = new Map<string, Set<string>>();

    if (fileIds.length === 0) {
      return owned;
    }

    const rows = await requireDb()
      .select({ fileId: fileTagsTable.fileId, tagId: fileTagsTable.tagId })
      .from(fileTagsTable)
      .where(inArray(fileTagsTable.fileId, [...fileIds]));

    for (const row of rows) {
      const set = owned.get(row.fileId) ?? new Set<string>();
      set.add(row.tagId);
      owned.set(row.fileId, set);
    }

    return owned;
  }

  async function noteTagIds(
    noteIds: readonly string[]
  ): Promise<Map<string, Set<string>>> {
    const owned = new Map<string, Set<string>>();

    if (noteIds.length === 0) {
      return owned;
    }

    const rows = await requireDb()
      .select({ noteId: noteTagsTable.noteId, tagId: noteTagsTable.tagId })
      .from(noteTagsTable)
      .where(inArray(noteTagsTable.noteId, [...noteIds]));

    for (const row of rows) {
      const set = owned.get(row.noteId) ?? new Set<string>();
      set.add(row.tagId);
      owned.set(row.noteId, set);
    }

    return owned;
  }

  function hasEvery(
    owned: Set<string> | undefined,
    required: readonly string[]
  ): boolean {
    if (owned === undefined) {
      return required.length === 0;
    }

    return required.every((tagId) => owned.has(tagId));
  }

  const workspaces: WorkspaceRepository = {
    async get(id) {
      return run(async () => {
        const rows = await requireDb()
          .select()
          .from(workspacesTable)
          .where(eq(workspacesTable.id, id))
          .limit(1);
        const row = rows[0];

        return row === undefined ? null : toWorkspace(row);
      });
    },
    async list() {
      return run(async () => {
        const rows = await requireDb().select().from(workspacesTable);

        return rows.map(toWorkspace);
      });
    },
    async create(input) {
      return run(async () => {
        const at = requireAt(input.at);
        const row: WorkspaceRow = {
          id: generateId(),
          name: input.name,
          createdAt: at,
          updatedAt: at,
        };
        await requireDb().insert(workspacesTable).values(row);

        return toWorkspace(row);
      });
    },
    async update(id, patch) {
      return run(async () => {
        const rows = await requireDb()
          .select()
          .from(workspacesTable)
          .where(eq(workspacesTable.id, id))
          .limit(1);
        const row = rows[0];

        if (row === undefined) {
          throw new NotFoundError("Workspace does not exist.");
        }

        const at = requireAt(patch.at);
        const next: WorkspaceRow = {
          ...row,
          name: patch.name,
          updatedAt: laterOf(at, row.updatedAt as IsoDate),
        };

        await requireDb()
          .update(workspacesTable)
          .set({ name: next.name, updatedAt: next.updatedAt })
          .where(eq(workspacesTable.id, id));

        return toWorkspace(next);
      });
    },
    async delete(id) {
      return run(async () => {
        const rows = await requireDb()
          .select({ id: workspacesTable.id })
          .from(workspacesTable)
          .where(eq(workspacesTable.id, id))
          .limit(1);

        if (rows.length === 0) {
          throw new NotFoundError("Workspace does not exist.");
        }

        await requireDb().delete(workspacesTable).where(eq(workspacesTable.id, id));
      });
    },
    async ensureWorkspace(input) {
      return run(async () => {
        const rows = await requireDb().select().from(workspacesTable);

        if (rows.length > 1) {
          throw new ConstraintError(
            "More than one workspace exists; refusing to guess which to use.",
            "multiple_workspaces"
          );
        }

        const existing = rows[0];

        if (existing !== undefined) {
          return toWorkspace(existing);
        }

        const at = requireAt(input?.at);
        const row: WorkspaceRow = {
          id: generateId(),
          name: input?.name ?? DEFAULT_WORKSPACE_NAME,
          createdAt: at,
          updatedAt: at,
        };
        await requireDb().insert(workspacesTable).values(row);

        return toWorkspace(row);
      });
    },
  };

  const folders: FolderRepository = {
    async create(input) {
      return run(async () => {
        const at = requireAt(input.at);

        if (input.parentId !== null) {
          const parent = await requireDb()
            .select({ id: foldersTable.id })
            .from(foldersTable)
            .where(eq(foldersTable.id, input.parentId))
            .limit(1);

          if (parent.length === 0) {
            throw new NotFoundError("Parent folder does not exist.");
          }
        }

        const row: FolderRow = {
          id: generateId(),
          workspaceId: input.workspaceId,
          parentId: input.parentId,
          name: input.name,
          createdAt: at,
          updatedAt: at,
        };
        await requireDb().insert(foldersTable).values(row);

        return toFolder(row);
      });
    },
    async get(id) {
      return run(async () => {
        const rows = await requireDb()
          .select()
          .from(foldersTable)
          .where(eq(foldersTable.id, id))
          .limit(1);
        const row = rows[0];

        return row === undefined ? null : toFolder(row);
      });
    },
    async update(id, patch) {
      return run(async () => {
        const rows = await requireDb()
          .select()
          .from(foldersTable)
          .where(eq(foldersTable.id, id))
          .limit(1);
        const row = rows[0];

        if (row === undefined) {
          throw new NotFoundError("Folder does not exist.");
        }

        const at = requireAt(patch.at);
        const next: FolderRow = {
          ...row,
          name: patch.name ?? row.name,
          parentId: patch.parentId === undefined ? row.parentId : patch.parentId,
          updatedAt: laterOf(at, row.updatedAt as IsoDate),
        };

        await requireDb()
          .update(foldersTable)
          .set({ name: next.name, parentId: next.parentId, updatedAt: next.updatedAt })
          .where(eq(foldersTable.id, id));

        return toFolder(next);
      });
    },
    async delete(id) {
      return run(async () => {
        const rows = await requireDb()
          .select({ id: foldersTable.id })
          .from(foldersTable)
          .where(eq(foldersTable.id, id))
          .limit(1);

        if (rows.length === 0) {
          throw new NotFoundError("Folder does not exist.");
        }

        await requireDb().delete(foldersTable).where(eq(foldersTable.id, id));
      });
    },
    async list(workspaceId, options) {
      return run(async () => {
        const rows = await requireDb()
          .select()
          .from(foldersTable)
          .where(eq(foldersTable.workspaceId, workspaceId));
        const sort = options?.sort ?? "name";

        return mapPage(
          paginate(
            rows,
            options,
            (row) => sortValueOf(sort, row, false),
            (row) => row.id
          ),
          toFolder
        );
      });
    },
    async listChildren(workspaceId, parentId) {
      return run(async () => {
        const conditions = [eq(foldersTable.workspaceId, workspaceId)];
        conditions.push(
          parentId === null
            ? isNull(foldersTable.parentId)
            : eq(foldersTable.parentId, parentId)
        );
        const rows = await requireDb()
          .select()
          .from(foldersTable)
          .where(and(...conditions));

        return rows.map(toFolder);
      });
    },
    async ancestors(id) {
      return run(async () => {
        const rows = await requireDb()
          .select({ parentId: foldersTable.parentId })
          .from(foldersTable)
          .where(eq(foldersTable.id, id))
          .limit(1);
        let cursor = rows[0]?.parentId ?? null;
        const chain: Folder[] = [];

        while (cursor !== null) {
          const parents = await requireDb()
            .select()
            .from(foldersTable)
            .where(eq(foldersTable.id, cursor))
            .limit(1);
          const parent = parents[0];

          if (parent === undefined) {
            break;
          }

          chain.unshift(toFolder(parent));
          cursor = parent.parentId;
        }

        return chain;
      });
    },
    async descendants(id) {
      return run(async () => {
        const ids = (await subtreeIds(id)).filter((candidate) => candidate !== id);

        if (ids.length === 0) {
          return [];
        }

        const rows = await requireDb()
          .select()
          .from(foldersTable)
          .where(inArray(foldersTable.id, ids));

        return rows.map(toFolder);
      });
    },
  };

  const files: FileRepository = {
    async create(input) {
      return run(async () => {
        const at = requireAt(input.at);
        const row: FileRow = {
          id: generateId(),
          workspaceId: input.workspaceId,
          folderId: input.folderId,
          name: input.name,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          blobKey: input.blobKey,
          checksum: input.checksum,
          createdAt: at,
          updatedAt: at,
        };
        await requireDb().insert(filesTable).values(row);

        return toFile(row);
      });
    },
    async get(id) {
      return run(async () => {
        const rows = await requireDb()
          .select()
          .from(filesTable)
          .where(eq(filesTable.id, id))
          .limit(1);
        const row = rows[0];

        return row === undefined ? null : toFile(row);
      });
    },
    async update(id, patch) {
      return run(async () => {
        const rows = await requireDb()
          .select()
          .from(filesTable)
          .where(eq(filesTable.id, id))
          .limit(1);
        const row = rows[0];

        if (row === undefined) {
          throw new NotFoundError("File does not exist.");
        }

        const at = requireAt(patch.at);
        const next: FileRow = {
          ...row,
          name: patch.name ?? row.name,
          folderId: patch.folderId === undefined ? row.folderId : patch.folderId,
          updatedAt: laterOf(at, row.updatedAt as IsoDate),
        };

        await requireDb()
          .update(filesTable)
          .set({ name: next.name, folderId: next.folderId, updatedAt: next.updatedAt })
          .where(eq(filesTable.id, id));

        return toFile(next);
      });
    },
    async delete(id) {
      return run(async () => {
        const rows = await requireDb()
          .select({ id: filesTable.id })
          .from(filesTable)
          .where(eq(filesTable.id, id))
          .limit(1);

        if (rows.length === 0) {
          throw new NotFoundError("File does not exist.");
        }

        await requireDb().delete(filesTable).where(eq(filesTable.id, id));
      });
    },
    async list(workspaceId, filter, options) {
      return run(async () => {
        const conditions = [eq(filesTable.workspaceId, workspaceId)];

        if (filter.folderId === null) {
          conditions.push(isNull(filesTable.folderId));
        } else if (filter.folderId !== undefined) {
          const ids = await subtreeIds(filter.folderId);

          if (ids.length === 0) {
            return { items: [], nextCursor: null, total: 0 };
          }

          conditions.push(inArray(filesTable.folderId, ids));
        }

        if (filter.mimeTypes !== undefined) {
          if (filter.mimeTypes.length === 0) {
            return { items: [], nextCursor: null, total: 0 };
          }

          conditions.push(inArray(filesTable.mimeType, [...filter.mimeTypes]));
        }

        let rows = await requireDb()
          .select()
          .from(filesTable)
          .where(and(...conditions));

        if (filter.tagIds !== undefined && filter.tagIds.length > 0) {
          const required = [...new Set<string>(filter.tagIds)];
          const owned = await fileTagIds(rows.map((row) => row.id));
          rows = rows.filter((row) => hasEvery(owned.get(row.id), required));
        }

        if (filter.text !== undefined) {
          const tokens = searchTokens(filter.text);

          if (tokens.length > 0) {
            rows = rows.filter((row) => matchesTokens(row.name, tokens));
          }
        }

        const sort = options?.sort ?? "name";

        return mapPage(
          paginate(
            rows,
            options,
            (row) => sortValueOf(sort, row, false),
            (row) => row.id
          ),
          toFile
        );
      });
    },
    async setTags(id, tagIds) {
      return run(async () =>
        atomic(async () => {
          const rows = await requireDb()
            .select({ id: filesTable.id })
            .from(filesTable)
            .where(eq(filesTable.id, id))
            .limit(1);

          if (rows.length === 0) {
            throw new NotFoundError("File does not exist.");
          }

          const unique = [...new Set<string>(tagIds)];
          await requireDb().delete(fileTagsTable).where(eq(fileTagsTable.fileId, id));

          if (unique.length > 0) {
            await requireDb()
              .insert(fileTagsTable)
              .values(unique.map((tagId) => ({ fileId: id, tagId })));
          }
        })
      );
    },
    async tags(id) {
      return run(async () => {
        const linked = await fileTagIds([id]);
        const owned = linked.get(id);

        if (owned === undefined || owned.size === 0) {
          return [];
        }

        const rows = await requireDb()
          .select()
          .from(tagsTable)
          .where(inArray(tagsTable.id, [...owned]));

        return rows.map(toTag);
      });
    },
  };

  const notes: NoteRepository = {
    async create(input) {
      return run(async () => {
        const at = requireAt(input.at);
        const row: NoteRow = {
          id: generateId(),
          workspaceId: input.workspaceId,
          folderId: input.folderId,
          title: input.title,
          content: input.content ?? "",
          pinned: input.pinned ?? false,
          createdAt: at,
          updatedAt: at,
        };
        await requireDb().insert(notesTable).values(row);

        return toNote(row);
      });
    },
    async get(id) {
      return run(async () => {
        const rows = await requireDb()
          .select()
          .from(notesTable)
          .where(eq(notesTable.id, id))
          .limit(1);
        const row = rows[0];

        return row === undefined ? null : toNote(row);
      });
    },
    async update(id, patch) {
      return run(async () => {
        const rows = await requireDb()
          .select()
          .from(notesTable)
          .where(eq(notesTable.id, id))
          .limit(1);
        const row = rows[0];

        if (row === undefined) {
          throw new NotFoundError("Note does not exist.");
        }

        const at = requireAt(patch.at);
        const next: NoteRow = {
          ...row,
          title: patch.title ?? row.title,
          content: patch.content ?? row.content,
          folderId: patch.folderId === undefined ? row.folderId : patch.folderId,
          pinned: patch.pinned === undefined ? row.pinned : patch.pinned,
          updatedAt: laterOf(at, row.updatedAt as IsoDate),
        };

        await requireDb()
          .update(notesTable)
          .set({
            title: next.title,
            content: next.content,
            folderId: next.folderId,
            pinned: next.pinned,
            updatedAt: next.updatedAt,
          })
          .where(eq(notesTable.id, id));

        return toNote(next);
      });
    },
    async delete(id) {
      return run(async () => {
        const rows = await requireDb()
          .select({ id: notesTable.id })
          .from(notesTable)
          .where(eq(notesTable.id, id))
          .limit(1);

        if (rows.length === 0) {
          throw new NotFoundError("Note does not exist.");
        }

        await requireDb().delete(notesTable).where(eq(notesTable.id, id));
      });
    },
    async list(workspaceId, filter, options) {
      return run(async () => {
        const conditions = [eq(notesTable.workspaceId, workspaceId)];

        if (filter.folderId === null) {
          conditions.push(isNull(notesTable.folderId));
        } else if (filter.folderId !== undefined) {
          const ids = await subtreeIds(filter.folderId);

          if (ids.length === 0) {
            return { items: [], nextCursor: null, total: 0 };
          }

          conditions.push(inArray(notesTable.folderId, ids));
        }

        if (filter.pinned !== undefined) {
          conditions.push(eq(notesTable.pinned, filter.pinned));
        }

        let rows = await requireDb()
          .select()
          .from(notesTable)
          .where(and(...conditions));

        if (filter.tagIds !== undefined && filter.tagIds.length > 0) {
          const required = [...new Set<string>(filter.tagIds)];
          const owned = await noteTagIds(rows.map((row) => row.id));
          rows = rows.filter((row) => hasEvery(owned.get(row.id), required));
        }

        if (filter.text !== undefined) {
          const tokens = searchTokens(filter.text);

          if (tokens.length > 0) {
            rows = rows.filter((row) =>
              matchesTokens(`${row.title} ${row.content}`, tokens)
            );
          }
        }

        const sort = options?.sort ?? "name";

        return mapPage(
          paginate(
            rows,
            options,
            (row) => sortValueOf(sort, row, true),
            (row) => row.id
          ),
          toNote
        );
      });
    },
    async setTags(id, tagIds) {
      return run(async () =>
        atomic(async () => {
          const rows = await requireDb()
            .select({ id: notesTable.id })
            .from(notesTable)
            .where(eq(notesTable.id, id))
            .limit(1);

          if (rows.length === 0) {
            throw new NotFoundError("Note does not exist.");
          }

          const unique = [...new Set<string>(tagIds)];
          await requireDb().delete(noteTagsTable).where(eq(noteTagsTable.noteId, id));

          if (unique.length > 0) {
            await requireDb()
              .insert(noteTagsTable)
              .values(unique.map((tagId) => ({ noteId: id, tagId })));
          }
        })
      );
    },
    async tags(id) {
      return run(async () => {
        const linked = await noteTagIds([id]);
        const owned = linked.get(id);

        if (owned === undefined || owned.size === 0) {
          return [];
        }

        const rows = await requireDb()
          .select()
          .from(tagsTable)
          .where(inArray(tagsTable.id, [...owned]));

        return rows.map(toTag);
      });
    },
    async setLinks(id, targetIds) {
      return run(async () =>
        atomic(async () => {
          const rows = await requireDb()
            .select({ id: notesTable.id })
            .from(notesTable)
            .where(eq(notesTable.id, id))
            .limit(1);

          if (rows.length === 0) {
            throw new NotFoundError("Note does not exist.");
          }

          const unique = [...new Set<string>(targetIds)];

          for (const targetId of unique) {
            assertNoSelfLink(id, targetId);
          }

          await requireDb()
            .delete(noteLinksTable)
            .where(eq(noteLinksTable.sourceNoteId, id));

          if (unique.length > 0) {
            await requireDb()
              .insert(noteLinksTable)
              .values(
                unique.map((targetId) => ({
                  sourceNoteId: id,
                  targetNoteId: targetId,
                }))
              );
          }
        })
      );
    },
    async links(id) {
      return run(async () => {
        const rows = await requireDb()
          .select()
          .from(noteLinksTable)
          .where(eq(noteLinksTable.sourceNoteId, id));

        return rows.map((row) => ({
          sourceNoteId: row.sourceNoteId as NoteLink["sourceNoteId"],
          targetNoteId: row.targetNoteId as NoteLink["targetNoteId"],
        }));
      });
    },
  };

  const tags: TagRepository = {
    async create(input) {
      return run(async () => {
        const at = requireAt(input.at);
        const row: TagRow = {
          id: generateId(),
          workspaceId: input.workspaceId,
          name: normalizeTagName(input.name).display,
          color: input.color ?? null,
          createdAt: at,
        };
        await requireDb().insert(tagsTable).values(row);

        return toTag(row);
      });
    },
    async get(id) {
      return run(async () => {
        const rows = await requireDb()
          .select()
          .from(tagsTable)
          .where(eq(tagsTable.id, id))
          .limit(1);
        const row = rows[0];

        return row === undefined ? null : toTag(row);
      });
    },
    async update(id, patch) {
      return run(async () => {
        const rows = await requireDb()
          .select()
          .from(tagsTable)
          .where(eq(tagsTable.id, id))
          .limit(1);
        const row = rows[0];

        if (row === undefined) {
          throw new NotFoundError("Tag does not exist.");
        }

        const next: TagRow = {
          ...row,
          name:
            patch.name === undefined ? row.name : normalizeTagName(patch.name).display,
          color: patch.color === undefined ? row.color : patch.color,
        };

        await requireDb()
          .update(tagsTable)
          .set({ name: next.name, color: next.color })
          .where(eq(tagsTable.id, id));

        return toTag(next);
      });
    },
    async delete(id) {
      return run(async () => {
        const rows = await requireDb()
          .select({ id: tagsTable.id })
          .from(tagsTable)
          .where(eq(tagsTable.id, id))
          .limit(1);

        if (rows.length === 0) {
          throw new NotFoundError("Tag does not exist.");
        }

        await requireDb().delete(tagsTable).where(eq(tagsTable.id, id));
      });
    },
    async list(workspaceId, options) {
      return run(async () => {
        const rows = await requireDb()
          .select()
          .from(tagsTable)
          .where(eq(tagsTable.workspaceId, workspaceId));
        const sort = options?.sort ?? "name";

        return mapPage(
          paginate(
            rows,
            options,
            (row) => sortValueOf(sort, row, false),
            (row) => row.id
          ),
          toTag
        );
      });
    },
    async findByName(workspaceId, key) {
      return run(async () => {
        const rows = await requireDb()
          .select()
          .from(tagsTable)
          .where(eq(tagsTable.workspaceId, workspaceId));
        const row = rows.find(
          (candidate) => normalizeTagName(candidate.name).key === key
        );

        return row === undefined ? null : toTag(row);
      });
    },
  };

  async function matchedFileHits(
    match: string,
    workspaceId: WorkspaceId,
    tokens: string[]
  ): Promise<SearchHit[]> {
    const matched = await requireDb().values<[string, number]>(sql`
      SELECT file.id, bm25(files_fts) AS score
      FROM files_fts
      JOIN files AS file ON file.rowid = files_fts.rowid
      WHERE files_fts MATCH ${match} AND file.workspace_id = ${workspaceId}
    `);
    const scoreOf = new Map(matched.map((row) => [String(row[0]), Number(row[1])]));
    const ids = [...scoreOf.keys()];

    if (ids.length === 0) {
      return [];
    }

    const rows = await requireDb()
      .select()
      .from(filesTable)
      .where(inArray(filesTable.id, ids));

    return rows
      .filter((row) => matchesTokens(row.name, tokens))
      .map((row) => ({
        kind: "file" as const,
        id: row.id,
        title: row.name,
        snippet: snippetOf(row.name, tokens),
        score: scoreOf.get(row.id) ?? 0,
      }));
  }

  async function matchedNoteHits(
    match: string,
    workspaceId: WorkspaceId,
    tokens: string[]
  ): Promise<SearchHit[]> {
    const matched = await requireDb().values<[string, number]>(sql`
      SELECT note.id, bm25(notes_fts) AS score
      FROM notes_fts
      JOIN notes AS note ON note.rowid = notes_fts.rowid
      WHERE notes_fts MATCH ${match} AND note.workspace_id = ${workspaceId}
    `);
    const scoreOf = new Map(matched.map((row) => [String(row[0]), Number(row[1])]));
    const ids = [...scoreOf.keys()];

    if (ids.length === 0) {
      return [];
    }

    const rows = await requireDb()
      .select()
      .from(notesTable)
      .where(inArray(notesTable.id, ids));

    return rows
      .filter((row) => matchesTokens(`${row.title} ${row.content}`, tokens))
      .map((row) => ({
        kind: "note" as const,
        id: row.id,
        title: row.title,
        snippet: snippetOf(`${row.title} ${row.content}`, tokens),
        score: scoreOf.get(row.id) ?? 0,
      }));
  }

  const search: SearchRepository = {
    async search(query) {
      return run(async () => {
        const tokens = searchTokens(query.text);

        if (tokens.length === 0) {
          return [];
        }

        const match = toMatchQuery(query.text);
        const foldedQuery = normalizeForSearch(query.text);
        const kinds = new Set(query.kinds ?? ["file", "note"]);
        let hits: SearchHit[] = [];

        if (kinds.has("file")) {
          hits = hits.concat(await matchedFileHits(match, query.workspaceId, tokens));
        }

        if (kinds.has("note")) {
          hits = hits.concat(await matchedNoteHits(match, query.workspaceId, tokens));
        }

        if (query.folderId !== undefined) {
          const folderIds =
            query.folderId === null ? null : new Set(await subtreeIds(query.folderId));
          const fileIds = hits.filter((hit) => hit.kind === "file").map((hit) => hit.id);
          const noteIds = hits.filter((hit) => hit.kind === "note").map((hit) => hit.id);
          const fileFolders = new Map<string, string | null>();
          const noteFolders = new Map<string, string | null>();

          if (fileIds.length > 0) {
            const rows = await requireDb()
              .select({ id: filesTable.id, folderId: filesTable.folderId })
              .from(filesTable)
              .where(inArray(filesTable.id, fileIds));

            for (const row of rows) {
              fileFolders.set(row.id, row.folderId);
            }
          }

          if (noteIds.length > 0) {
            const rows = await requireDb()
              .select({ id: notesTable.id, folderId: notesTable.folderId })
              .from(notesTable)
              .where(inArray(notesTable.id, noteIds));

            for (const row of rows) {
              noteFolders.set(row.id, row.folderId);
            }
          }

          hits = hits.filter((hit) => {
            const folderId =
              hit.kind === "file" ? fileFolders.get(hit.id) : noteFolders.get(hit.id);

            if (folderId === undefined) {
              return false;
            }

            return folderIds === null
              ? folderId === null
              : folderId !== null && folderIds.has(folderId);
          });
        }

        if (query.tagIds !== undefined && query.tagIds.length > 0) {
          const required = [...new Set<string>(query.tagIds)];
          const fileHits = hits.filter((hit) => hit.kind === "file");
          const noteHits = hits.filter((hit) => hit.kind === "note");
          const ownedFiles = await fileTagIds(fileHits.map((hit) => hit.id));
          const ownedNotes = await noteTagIds(noteHits.map((hit) => hit.id));

          hits = hits.filter((hit) =>
            hit.kind === "file"
              ? hasEvery(ownedFiles.get(hit.id), required)
              : hasEvery(ownedNotes.get(hit.id), required)
          );
        }

        const tierOf = (hit: SearchHit): number => {
          const foldedTitle = normalizeForSearch(hit.title);

          if (foldedTitle === foldedQuery) {
            return 0;
          }

          if (foldedTitle.startsWith(foldedQuery)) {
            return 1;
          }

          if (
            tokens.every((token) =>
              foldedTitle.split(" ").some((word) => word.startsWith(token))
            )
          ) {
            return 2;
          }

          return 3;
        };

        const offset = query.offset ?? 0;
        const limit = query.limit ?? DEFAULT_LIMIT;

        return hits
          .sort((left, right) => {
            const tier = tierOf(left) - tierOf(right);

            if (tier !== 0) {
              return tier;
            }

            const leftTitle = normalizeForSearch(left.title);
            const rightTitle = normalizeForSearch(right.title);

            if (leftTitle !== rightTitle) {
              return leftTitle < rightTitle ? -1 : 1;
            }

            return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
          })
          .slice(offset, offset + limit);
      });
    },
    async reindexAll(workspaceId) {
      return run(async () => {
        void workspaceId;
        await requireDb().run(sql`INSERT INTO files_fts(files_fts) VALUES ('rebuild')`);
        await requireDb().run(sql`INSERT INTO notes_fts(notes_fts) VALUES ('rebuild')`);
      });
    },
  };

  const adapter: StorageAdapter = {
    kind: "sqlite",
    get schemaVersion() {
      return schemaVersion;
    },
    workspaces,
    folders,
    files,
    notes,
    tags,
    search,
    blobs,
    async transaction(work) {
      guard();

      if (transactionDepth > 0) {
        throw new UnsupportedError(
          "Nested transactions are not supported.",
          "nested_transaction"
        );
      }

      const sqlite = connection as DatabaseSync;
      transactionDepth = 1;

      try {
        sqlite.exec("BEGIN IMMEDIATE");

        try {
          const result = await work(adapter);
          sqlite.exec("COMMIT");

          return result;
        } catch (error) {
          try {
            sqlite.exec("ROLLBACK");
          } catch {
            // The transaction was already rolled back by SQLite.
          }

          throw error;
        }
      } catch (error) {
        throw mapSqliteError(error);
      } finally {
        transactionDepth = 0;
      }
    },
    async init() {
      if (connection !== null) {
        return;
      }

      closed = false;

      try {
        const opened = await openDatabase(config.databaseFile);
        connection = opened.sqlite;
        db = opened.db;
        schemaVersion = opened.migrationCount;
      } catch (error) {
        throw mapSqliteError(error);
      }
    },
    async close() {
      if (connection === null) {
        closed = true;

        return;
      }

      const sqlite = connection;
      connection = null;
      db = null;
      closed = true;

      sqlite.close();
    },
    async reset() {
      return run(async () => {
        await atomic(async () => {
          await requireDb().delete(workspacesTable);
        });
        await blobs.purgeOrphans([]);
      });
    },
    async restore(snapshot) {
      return run(async () => {
        const parsed = parseSnapshot(snapshot);
        const newlyWritten: BlobKey[] = [];

        for (const blob of parsed.blobs) {
          const existed = await blobs.has(blob.key);

          await blobs.put(
            blob.key,
            new Blob([new Uint8Array(blob.data)], { type: blob.mimeType })
          );

          if (!existed) {
            newlyWritten.push(blob.key);
          }
        }

        try {
          await atomic(async () => {
            const database = requireDb();
            await database.run(sql`PRAGMA defer_foreign_keys = ON`);

            await database.delete(workspacesTable);
            await database.insert(workspacesTable).values({
              id: parsed.workspace.id,
              name: parsed.workspace.name,
              createdAt: parsed.workspace.createdAt,
              updatedAt: parsed.workspace.updatedAt,
            });

            if (parsed.folders.length > 0) {
              await database.insert(foldersTable).values(
                parsed.folders.map((folder) => ({
                  id: folder.id,
                  workspaceId: folder.workspaceId,
                  parentId: folder.parentId,
                  name: folder.name,
                  createdAt: folder.createdAt,
                  updatedAt: folder.updatedAt,
                }))
              );
            }

            if (parsed.files.length > 0) {
              await database.insert(filesTable).values(
                parsed.files.map((file) => ({
                  id: file.id,
                  workspaceId: file.workspaceId,
                  folderId: file.folderId,
                  name: file.name,
                  mimeType: file.mimeType,
                  sizeBytes: file.sizeBytes,
                  blobKey: file.blobKey,
                  checksum: file.checksum,
                  createdAt: file.createdAt,
                  updatedAt: file.updatedAt,
                }))
              );
            }

            if (parsed.notes.length > 0) {
              await database.insert(notesTable).values(
                parsed.notes.map((note) => ({
                  id: note.id,
                  workspaceId: note.workspaceId,
                  folderId: note.folderId,
                  title: note.title,
                  content: note.content,
                  pinned: note.pinned,
                  createdAt: note.createdAt,
                  updatedAt: note.updatedAt,
                }))
              );
            }

            if (parsed.tags.length > 0) {
              await database.insert(tagsTable).values(
                parsed.tags.map((tag) => ({
                  id: tag.id,
                  workspaceId: tag.workspaceId,
                  name: tag.name,
                  color: tag.color,
                  createdAt: tag.createdAt,
                }))
              );
            }

            if (parsed.fileTags.length > 0) {
              await database.insert(fileTagsTable).values(
                parsed.fileTags.map((link) => ({
                  fileId: link.fileId,
                  tagId: link.tagId,
                }))
              );
            }

            if (parsed.noteTags.length > 0) {
              await database.insert(noteTagsTable).values(
                parsed.noteTags.map((link) => ({
                  noteId: link.noteId,
                  tagId: link.tagId,
                }))
              );
            }

            if (parsed.noteLinks.length > 0) {
              await database.insert(noteLinksTable).values(
                parsed.noteLinks.map((link) => ({
                  sourceNoteId: link.sourceNoteId,
                  targetNoteId: link.targetNoteId,
                }))
              );
            }
          });
        } catch (error) {
          for (const key of newlyWritten) {
            await blobs.delete(key);
          }

          throw error;
        }

        await blobs.purgeOrphans(parsed.files.map((file) => file.blobKey));
      });
    },
  };

  return adapter;
}
