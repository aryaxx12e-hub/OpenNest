import {
  ConflictError,
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
  type BackupSnapshot,
  type BlobStore,
  type DexieStorageConfig,
  type FileRepository,
  type Folder,
  type FolderId,
  type FolderRepository,
  type IsoDate,
  type Note,
  type NoteLink,
  type NoteRepository,
  type Page,
  type SearchHit,
  type SearchRepository,
  type SortField,
  type StoredFile,
  type StorageAdapter,
  type Tag,
  type TagRepository,
  type Workspace,
  type WorkspaceRepository,
} from "@opennest/core";
import { backupSnapshotSchema } from "@opennest/validation";

import { mapStorageError } from "./errors";
import { DEFAULT_LIMIT, paginate } from "./pagination";
import { laterOf, requireAt } from "./repo-helpers";
import {
  OpenNestDexie,
  type BlobRow,
  type FileRow,
  type FolderRow,
  type NoteRow,
  type StorageOptions,
  type TagRow,
  type WorkspaceRow,
} from "./schema";

export interface DexieStorageOptions extends DexieStorageConfig {
  indexedDB?: IDBFactory;
  IDBKeyRange?: typeof IDBKeyRange;
}

// Decimal "storage schema" version, not Dexie's engine version. Version 2 only
// added indexes, so the data format is unchanged and backups stay identical to
// the other adapters. See schema.ts for the Dexie version itself.
const SCHEMA_VERSION = 1;
const DEFAULT_WORKSPACE_NAME = "Workspace";

function toWorkspace(row: WorkspaceRow): Workspace {
  return { ...row } as Workspace;
}

function toFolder(row: FolderRow): Folder {
  return { ...row } as Folder;
}

function toFile(row: FileRow): StoredFile {
  return { ...row } as StoredFile;
}

function toNote(row: NoteRow): Note {
  return { ...row, pinned: row.pinned === 1 } as Note;
}

function toTag(row: TagRow): Tag {
  return { ...row } as Tag;
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

export function createDexieStorage(config: DexieStorageOptions): StorageAdapter {
  const options: StorageOptions = {
    ...(config.indexedDB === undefined ? {} : { indexedDB: config.indexedDB }),
    ...(config.IDBKeyRange === undefined ? {} : { IDBKeyRange: config.IDBKeyRange }),
  };
  const db = new OpenNestDexie(config.databaseName, options);

  let closed = false;
  let transactionDepth = 0;

  function guard(): void {
    if (closed) {
      throw new StorageError("The storage adapter is closed.", "closed");
    }
  }

  async function run<T>(work: () => Promise<T>): Promise<T> {
    guard();

    try {
      return await work();
    } catch (error) {
      throw mapStorageError(error);
    }
  }

  async function requireFolder(id: FolderId): Promise<FolderRow> {
    const row = await db.folders.get(id);

    if (row === undefined) {
      throw new NotFoundError("Folder does not exist.");
    }

    return row;
  }

  async function requireNote(id: string): Promise<NoteRow> {
    const row = await db.notes.get(id);

    if (row === undefined) {
      throw new NotFoundError("Note does not exist.");
    }

    return row;
  }

  async function requireFile(id: string): Promise<FileRow> {
    const row = await db.files.get(id);

    if (row === undefined) {
      throw new NotFoundError("File does not exist.");
    }

    return row;
  }

  async function requireTag(id: string): Promise<TagRow> {
    const row = await db.tags.get(id);

    if (row === undefined) {
      throw new NotFoundError("Tag does not exist.");
    }

    return row;
  }

  async function subtreeIds(folderId: FolderId): Promise<Set<string>> {
    const ids = new Set<string>([folderId]);
    const all = await db.folders.toArray();
    let changed = true;

    while (changed) {
      changed = false;

      for (const folder of all) {
        if (folder.parentId !== null && ids.has(folder.parentId) && !ids.has(folder.id)) {
          ids.add(folder.id);
          changed = true;
        }
      }
    }

    return ids;
  }

  async function fileTagIds(fileId: string): Promise<Set<string>> {
    const rows = await db.fileTags.where("fileId").equals(fileId).toArray();

    return new Set(rows.map((row) => row.tagId));
  }

  async function noteTagIds(noteId: string): Promise<Set<string>> {
    const rows = await db.noteTags.where("noteId").equals(noteId).toArray();

    return new Set(rows.map((row) => row.tagId));
  }

  async function filterByFolder<T extends { folderId: string | null }>(
    rows: T[],
    folderId: FolderId | null | undefined
  ): Promise<T[]> {
    if (folderId === undefined) {
      return rows;
    }

    if (folderId === null) {
      return rows.filter((row) => row.folderId === null);
    }

    const ids = await subtreeIds(folderId);

    return rows.filter((row) => row.folderId !== null && ids.has(row.folderId));
  }

  const workspaces: WorkspaceRepository = {
    get(id) {
      return run(async () => {
        const row = await db.workspaces.get(id);

        return row === undefined ? null : toWorkspace(row);
      });
    },
    list() {
      return run(async () => (await db.workspaces.toArray()).map(toWorkspace));
    },
    create(input) {
      return run(async () => {
        const at = requireAt(input.at);
        const row: WorkspaceRow = {
          id: generateId(),
          name: input.name,
          createdAt: at,
          updatedAt: at,
        };
        await db.workspaces.add(row);

        return toWorkspace(row);
      });
    },
    update(id, patch) {
      return run(async () => {
        const row = await db.workspaces.get(id);

        if (row === undefined) {
          throw new NotFoundError("Workspace does not exist.");
        }

        const at = requireAt(patch.at);
        const next: WorkspaceRow = {
          ...row,
          name: patch.name,
          updatedAt: laterOf(at, row.updatedAt as IsoDate),
        };
        await db.workspaces.put(next);

        return toWorkspace(next);
      });
    },
    delete(id) {
      return run(async () => {
        if ((await db.workspaces.get(id)) === undefined) {
          throw new NotFoundError("Workspace does not exist.");
        }

        const files = await db.files.where("workspaceId").equals(id).toArray();
        const notes = await db.notes.where("workspaceId").equals(id).toArray();
        const tags = await db.tags.where("workspaceId").equals(id).toArray();
        const tagIds = new Set(tags.map((row) => row.id));
        const fileIds = new Set(files.map((row) => row.id));
        const noteIds = new Set(notes.map((row) => row.id));

        await db.folders.where("workspaceId").equals(id).delete();
        await db.files.where("workspaceId").equals(id).delete();
        await db.notes.where("workspaceId").equals(id).delete();
        await db.tags.where("workspaceId").equals(id).delete();

        await db.fileTags
          .filter((row) => fileIds.has(row.fileId) || tagIds.has(row.tagId))
          .delete();
        await db.noteTags
          .filter((row) => noteIds.has(row.noteId) || tagIds.has(row.tagId))
          .delete();
        await db.noteLinks
          .filter((row) => noteIds.has(row.sourceNoteId) || noteIds.has(row.targetNoteId))
          .delete();
        await db.workspaces.delete(id);
      });
    },
    ensureWorkspace(input) {
      return run(async () => {
        const apply = async () => {
          const all = await db.workspaces.toArray();

          if (all.length > 1) {
            return null;
          }

          const existing = all[0];

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
          await db.workspaces.add(row);

          return toWorkspace(row);
        };

        const ensured =
          transactionDepth > 0
            ? await apply()
            : await db.transaction("rw", db.workspaces, apply);

        if (ensured === null) {
          throw new ConstraintError(
            "More than one workspace exists; refusing to guess which to use.",
            "multiple_workspaces"
          );
        }

        return ensured;
      });
    },
  };

  const folders: FolderRepository = {
    create(input) {
      return run(async () => {
        const at = requireAt(input.at);

        if (input.parentId !== null) {
          await requireFolder(input.parentId);
        }

        const row: FolderRow = {
          id: generateId(),
          workspaceId: input.workspaceId,
          parentId: input.parentId,
          name: input.name,
          createdAt: at,
          updatedAt: at,
        };
        await db.folders.add(row);

        return toFolder(row);
      });
    },
    get(id) {
      return run(async () => {
        const row = await db.folders.get(id);

        return row === undefined ? null : toFolder(row);
      });
    },
    update(id, patch) {
      return run(async () => {
        const row = await requireFolder(id);
        const at = requireAt(patch.at);
        const next: FolderRow = {
          ...row,
          name: patch.name ?? row.name,
          parentId: patch.parentId === undefined ? row.parentId : patch.parentId,
          updatedAt: laterOf(at, row.updatedAt as IsoDate),
        };
        await db.folders.put(next);

        return toFolder(next);
      });
    },
    delete(id) {
      return run(async () => {
        await requireFolder(id);
        await db.transaction("rw", db.folders, db.files, db.notes, async () => {
          await db.folders.where("parentId").equals(id).modify({ parentId: null });
          await db.files.where("folderId").equals(id).modify({ folderId: null });
          await db.notes.where("folderId").equals(id).modify({ folderId: null });
          await db.folders.delete(id);
        });
      });
    },
    list(workspaceId, options) {
      return run(async () => {
        const rows = await db.folders.where("workspaceId").equals(workspaceId).toArray();
        const sort = options?.sort ?? "name";

        return mapPage(
          paginate(
            rows,
            options,
            (row) => sortValueOf(sort, { ...row }, false),
            (row) => row.id
          ),
          toFolder
        );
      });
    },
    listChildren(workspaceId, parentId) {
      return run(async () => {
        const rows = await db.folders.where("workspaceId").equals(workspaceId).toArray();

        return rows.filter((row) => row.parentId === parentId).map(toFolder);
      });
    },
    ancestors(id) {
      return run(async () => {
        const chain: Folder[] = [];
        let cursor = (await db.folders.get(id))?.parentId ?? null;

        while (cursor !== null) {
          const parent = await db.folders.get(cursor);

          if (parent === undefined) {
            break;
          }

          chain.unshift(toFolder(parent));
          cursor = parent.parentId;
        }

        return chain;
      });
    },
    descendants(id) {
      return run(async () => {
        const ids = await subtreeIds(id);
        ids.delete(id);

        const rows = await db.folders.toArray();

        return rows.filter((row) => ids.has(row.id)).map(toFolder);
      });
    },
  };

  const files: FileRepository = {
    create(input) {
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
        await db.files.add(row);

        return toFile(row);
      });
    },
    get(id) {
      return run(async () => {
        const row = await db.files.get(id);

        return row === undefined ? null : toFile(row);
      });
    },
    update(id, patch) {
      return run(async () => {
        const row = await requireFile(id);
        const at = requireAt(patch.at);
        const next: FileRow = {
          ...row,
          name: patch.name ?? row.name,
          folderId: patch.folderId === undefined ? row.folderId : patch.folderId,
          updatedAt: laterOf(at, row.updatedAt as IsoDate),
        };
        await db.files.put(next);

        return toFile(next);
      });
    },
    delete(id) {
      return run(async () => {
        await requireFile(id);
        await db.transaction("rw", db.files, db.fileTags, async () => {
          await db.fileTags.where("fileId").equals(id).delete();
          await db.files.delete(id);
        });
      });
    },
    list(workspaceId, filter, options) {
      return run(async () => {
        let rows = await db.files.where("workspaceId").equals(workspaceId).toArray();
        rows = await filterByFolder(rows, filter.folderId);

        if (filter.mimeTypes !== undefined) {
          const allowed = new Set(filter.mimeTypes);
          rows = rows.filter((row) => row.mimeType !== null && allowed.has(row.mimeType));
        }

        if (filter.tagIds !== undefined && filter.tagIds.length > 0) {
          const required = [...new Set<string>(filter.tagIds)];
          const matches: FileRow[] = [];

          for (const row of rows) {
            const owned = await fileTagIds(row.id);

            if (required.every((tagId) => owned.has(tagId))) {
              matches.push(row);
            }
          }

          rows = matches;
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
            (row) => sortValueOf(sort, { ...row }, false),
            (row) => row.id
          ),
          toFile
        );
      });
    },
    setTags(id, tagIds) {
      return run(async () => {
        await requireFile(id);
        const unique = [...new Set<string>(tagIds)];
        await db.transaction("rw", db.files, db.fileTags, async () => {
          await db.fileTags.where("fileId").equals(id).delete();

          for (const tagId of unique) {
            await db.fileTags.put({ fileId: id, tagId });
          }
        });
      });
    },
    tags(id) {
      return run(async () => {
        const ids = await fileTagIds(id);
        const rows = await db.tags.toArray();

        return rows.filter((row) => ids.has(row.id)).map(toTag);
      });
    },
  };

  const notes: NoteRepository = {
    create(input) {
      return run(async () => {
        const at = requireAt(input.at);
        const row: NoteRow = {
          id: generateId(),
          workspaceId: input.workspaceId,
          folderId: input.folderId,
          title: input.title,
          content: input.content ?? "",
          pinned: input.pinned === true ? 1 : 0,
          createdAt: at,
          updatedAt: at,
        };
        await db.notes.add(row);

        return toNote(row);
      });
    },
    get(id) {
      return run(async () => {
        const row = await db.notes.get(id);

        return row === undefined ? null : toNote(row);
      });
    },
    update(id, patch) {
      return run(async () => {
        const apply = async () => {
          const row = await db.notes.get(id);

          if (row === undefined) {
            return null;
          }

          const at = requireAt(patch.at);
          const changes: Partial<NoteRow> = {
            updatedAt: laterOf(at, row.updatedAt as IsoDate),
          };

          if (patch.title !== undefined) {
            changes.title = patch.title;
          }

          if (patch.content !== undefined) {
            changes.content = patch.content;
          }

          if (patch.folderId !== undefined) {
            changes.folderId = patch.folderId;
          }

          if (patch.pinned !== undefined) {
            changes.pinned = patch.pinned ? 1 : 0;
          }

          await db.notes.update(id, changes);

          const next: NoteRow = {
            ...row,
            title: changes.title ?? row.title,
            content: changes.content ?? row.content,
            folderId: changes.folderId === undefined ? row.folderId : changes.folderId,
            pinned: changes.pinned === undefined ? row.pinned : changes.pinned,
            updatedAt: changes.updatedAt ?? row.updatedAt,
          };

          return toNote(next);
        };

        const updated =
          transactionDepth > 0
            ? await apply()
            : await db.transaction("rw", db.notes, apply);

        if (updated === null) {
          throw new NotFoundError("Note does not exist.");
        }

        return updated;
      });
    },
    delete(id) {
      return run(async () => {
        await requireNote(id);
        await db.transaction("rw", db.notes, db.noteTags, db.noteLinks, async () => {
          await db.noteTags.where("noteId").equals(id).delete();
          await db.noteLinks.where("sourceNoteId").equals(id).delete();
          await db.noteLinks.where("targetNoteId").equals(id).delete();
          await db.notes.delete(id);
        });
      });
    },
    list(workspaceId, filter, options) {
      return run(async () => {
        let rows = await db.notes.where("workspaceId").equals(workspaceId).toArray();
        rows = await filterByFolder(rows, filter.folderId);

        if (filter.pinned !== undefined) {
          const wanted = filter.pinned ? 1 : 0;
          rows = rows.filter((row) => row.pinned === wanted);
        }

        if (filter.tagIds !== undefined && filter.tagIds.length > 0) {
          const required = [...new Set<string>(filter.tagIds)];
          const matches: NoteRow[] = [];

          for (const row of rows) {
            const owned = await noteTagIds(row.id);

            if (required.every((tagId) => owned.has(tagId))) {
              matches.push(row);
            }
          }

          rows = matches;
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
            (row) => sortValueOf(sort, { ...row }, true),
            (row) => row.id
          ),
          toNote
        );
      });
    },
    setTags(id, tagIds) {
      return run(async () => {
        await requireNote(id);
        const unique = [...new Set<string>(tagIds)];
        await db.transaction("rw", db.notes, db.noteTags, async () => {
          await db.noteTags.where("noteId").equals(id).delete();

          for (const tagId of unique) {
            await db.noteTags.put({ noteId: id, tagId });
          }
        });
      });
    },
    tags(id) {
      return run(async () => {
        const ids = await noteTagIds(id);
        const rows = await db.tags.toArray();

        return rows.filter((row) => ids.has(row.id)).map(toTag);
      });
    },
    setLinks(id, targetIds) {
      return run(async () => {
        await requireNote(id);
        const unique = [...new Set<string>(targetIds)];

        for (const targetId of unique) {
          assertNoSelfLink(id, targetId);
        }

        await db.transaction("rw", db.notes, db.noteLinks, async () => {
          await db.noteLinks.where("sourceNoteId").equals(id).delete();

          for (const targetId of unique) {
            await db.noteLinks.put({ sourceNoteId: id, targetNoteId: targetId });
          }
        });
      });
    },
    links(id) {
      return run(async () => {
        const rows = await db.noteLinks.where("sourceNoteId").equals(id).toArray();

        return rows.map((row) => ({
          sourceNoteId: row.sourceNoteId,
          targetNoteId: row.targetNoteId,
        })) as NoteLink[];
      });
    },
  };

  const tags: TagRepository = {
    create(input) {
      return run(async () => {
        const at = requireAt(input.at);
        const { display } = normalizeTagName(input.name);
        const row: TagRow = {
          id: generateId(),
          workspaceId: input.workspaceId,
          name: display,
          color: input.color ?? null,
          createdAt: at,
        };

        try {
          await db.tags.add(row);
        } catch (error) {
          if (isUniqueViolation(error)) {
            throw new ConflictError(
              "A tag with that name already exists.",
              "duplicate_tag_name",
              { cause: error }
            );
          }

          throw error;
        }

        return toTag(row);
      });
    },
    get(id) {
      return run(async () => {
        const row = await db.tags.get(id);

        return row === undefined ? null : toTag(row);
      });
    },
    update(id, patch) {
      return run(async () => {
        const row = await requireTag(id);
        const next: TagRow = {
          ...row,
          name:
            patch.name === undefined ? row.name : normalizeTagName(patch.name).display,
          color: patch.color === undefined ? row.color : patch.color,
        };

        try {
          await db.tags.put(next);
        } catch (error) {
          if (isUniqueViolation(error)) {
            throw new ConflictError(
              "A tag with that name already exists.",
              "duplicate_tag_name",
              { cause: error }
            );
          }

          throw error;
        }

        return toTag(next);
      });
    },
    delete(id) {
      return run(async () => {
        await requireTag(id);
        await db.transaction("rw", db.tags, db.fileTags, db.noteTags, async () => {
          await db.fileTags.where("tagId").equals(id).delete();
          await db.noteTags.where("tagId").equals(id).delete();
          await db.tags.delete(id);
        });
      });
    },
    list(workspaceId, options) {
      return run(async () => {
        const rows = await db.tags.where("workspaceId").equals(workspaceId).toArray();
        const sort = options?.sort ?? "name";

        return mapPage(
          paginate(
            rows,
            options,
            (row) =>
              sort === "name"
                ? normalizeForSearch(row.name)
                : sortValueOf(sort, { ...row }, false),
            (row) => row.id
          ),
          toTag
        );
      });
    },
    findByName(workspaceId, key) {
      return run(async () => {
        const rows = await db.tags.where("workspaceId").equals(workspaceId).toArray();
        const row = rows.find(
          (candidate) => normalizeTagName(candidate.name).key === key
        );

        return row === undefined ? null : toTag(row);
      });
    },
  };

  const search: SearchRepository = {
    search(query) {
      return run(async () => {
        const tokens = searchTokens(query.text);

        if (tokens.length === 0) {
          return [];
        }

        const foldedQuery = normalizeForSearch(query.text);
        const kinds = new Set(query.kinds ?? ["file", "note"]);
        const hits: SearchHit[] = [];

        if (kinds.has("file")) {
          let rows = await db.files
            .where("workspaceId")
            .equals(query.workspaceId)
            .toArray();
          rows = await filterByFolder(rows, query.folderId);

          if (query.tagIds !== undefined && query.tagIds.length > 0) {
            const required = [...new Set<string>(query.tagIds)];
            const matches: FileRow[] = [];

            for (const row of rows) {
              const owned = await fileTagIds(row.id);

              if (required.every((tagId) => owned.has(tagId))) {
                matches.push(row);
              }
            }

            rows = matches;
          }

          for (const row of rows) {
            if (matchesTokens(row.name, tokens)) {
              hits.push({
                kind: "file",
                id: row.id,
                title: row.name,
                snippet: snippetOf(row.name, tokens),
                score: 0,
              });
            }
          }
        }

        if (kinds.has("note")) {
          let rows = await db.notes
            .where("workspaceId")
            .equals(query.workspaceId)
            .toArray();
          rows = await filterByFolder(rows, query.folderId);

          if (query.tagIds !== undefined && query.tagIds.length > 0) {
            const required = [...new Set<string>(query.tagIds)];
            const matches: NoteRow[] = [];

            for (const row of rows) {
              const owned = await noteTagIds(row.id);

              if (required.every((tagId) => owned.has(tagId))) {
                matches.push(row);
              }
            }

            rows = matches;
          }

          for (const row of rows) {
            if (matchesTokens(`${row.title} ${row.content}`, tokens)) {
              hits.push({
                kind: "note",
                id: row.id,
                title: row.title,
                snippet: snippetOf(`${row.title} ${row.content}`, tokens),
                score: 0,
              });
            }
          }
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
    reindexAll() {
      return run(async () => undefined);
    },
  };

  const blobs: BlobStore = {
    put(key, data) {
      return run(async () => {
        const bytes =
          data instanceof Uint8Array
            ? new Uint8Array(data)
            : new Uint8Array(await data.arrayBuffer());
        const mimeType = data instanceof Uint8Array ? "" : data.type;
        const row: BlobRow = {
          key,
          type: mimeType,
          size: bytes.byteLength,
          data: bytes,
        };
        await db.blobs.put(row);
      });
    },
    get(key) {
      return run(async () => {
        const row = await db.blobs.get(key);

        if (row === undefined) {
          return null;
        }

        return new Blob([new Uint8Array(row.data).buffer], { type: row.type });
      });
    },
    delete(key) {
      return run(async () => {
        await db.blobs.delete(key);
      });
    },
    has(key) {
      return run(async () => (await db.blobs.get(key)) !== undefined);
    },
    usage() {
      return run(async () => {
        const rows = await db.blobs.toArray();

        return {
          bytes: rows.reduce((total, row) => total + row.size, 0),
          items: rows.length,
        };
      });
    },
    purgeOrphans(knownKeys) {
      return run(async () => {
        const known = new Set<string>(knownKeys);
        const rows = await db.blobs.toArray();
        const orphans = rows.filter((row) => !known.has(row.key)).map((row) => row.key);

        if (orphans.length > 0) {
          await db.blobs.bulkDelete(orphans);
        }

        return orphans.length;
      });
    },
  };

  const adapter: StorageAdapter = {
    kind: "dexie",
    schemaVersion: SCHEMA_VERSION,
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

      transactionDepth += 1;

      try {
        return await db.transaction(
          "rw",
          [
            db.workspaces,
            db.folders,
            db.files,
            db.notes,
            db.tags,
            db.fileTags,
            db.noteTags,
            db.noteLinks,
            db.blobs,
          ],
          async () => work(adapter)
        );
      } catch (error) {
        throw mapStorageError(error);
      } finally {
        transactionDepth -= 1;
      }
    },
    async init() {
      closed = false;

      try {
        await db.open();
      } catch (error) {
        throw mapStorageError(error);
      }
    },
    async close() {
      if (closed) {
        return;
      }

      db.close();
      closed = true;
    },
    async reset() {
      return run(async () => {
        await db.transaction(
          "rw",
          [
            db.workspaces,
            db.folders,
            db.files,
            db.notes,
            db.tags,
            db.fileTags,
            db.noteTags,
            db.noteLinks,
            db.blobs,
          ],
          async () => {
            await Promise.all([
              db.workspaces.clear(),
              db.folders.clear(),
              db.files.clear(),
              db.notes.clear(),
              db.tags.clear(),
              db.fileTags.clear(),
              db.noteTags.clear(),
              db.noteLinks.clear(),
              db.blobs.clear(),
            ]);
          }
        );
      });
    },
    async restore(snapshot) {
      return run(async () => {
        const parsed = parseSnapshot(snapshot);

        await db.transaction(
          "rw",
          [
            db.workspaces,
            db.folders,
            db.files,
            db.notes,
            db.tags,
            db.fileTags,
            db.noteTags,
            db.noteLinks,
            db.blobs,
          ],
          async () => {
            await Promise.all([
              db.workspaces.clear(),
              db.folders.clear(),
              db.files.clear(),
              db.notes.clear(),
              db.tags.clear(),
              db.fileTags.clear(),
              db.noteTags.clear(),
              db.noteLinks.clear(),
              db.blobs.clear(),
            ]);

            await db.workspaces.add({
              id: parsed.workspace.id,
              name: parsed.workspace.name,
              createdAt: parsed.workspace.createdAt,
              updatedAt: parsed.workspace.updatedAt,
            });

            for (const folder of parsed.folders) {
              await db.folders.put({
                id: folder.id,
                workspaceId: folder.workspaceId,
                parentId: folder.parentId,
                name: folder.name,
                createdAt: folder.createdAt,
                updatedAt: folder.updatedAt,
              });
            }

            for (const file of parsed.files) {
              await db.files.put({
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
              });
            }

            for (const note of parsed.notes) {
              await db.notes.put({
                id: note.id,
                workspaceId: note.workspaceId,
                folderId: note.folderId,
                title: note.title,
                content: note.content,
                pinned: note.pinned ? 1 : 0,
                createdAt: note.createdAt,
                updatedAt: note.updatedAt,
              });
            }

            for (const tag of parsed.tags) {
              await db.tags.put({
                id: tag.id,
                workspaceId: tag.workspaceId,
                name: tag.name,
                color: tag.color,
                createdAt: tag.createdAt,
              });
            }

            for (const link of parsed.fileTags) {
              await db.fileTags.put({ fileId: link.fileId, tagId: link.tagId });
            }

            for (const link of parsed.noteTags) {
              await db.noteTags.put({ noteId: link.noteId, tagId: link.tagId });
            }

            for (const link of parsed.noteLinks) {
              await db.noteLinks.put({
                sourceNoteId: link.sourceNoteId,
                targetNoteId: link.targetNoteId,
              });
            }

            for (const blob of parsed.blobs) {
              const bytes = new Uint8Array(blob.data);
              await db.blobs.put({
                key: blob.key,
                type: blob.mimeType,
                size: bytes.byteLength,
                data: bytes,
              });
            }
          }
        );
      });
    },
  };

  return adapter;
}

function matchesTokens(text: string, tokens: string[]): boolean {
  const words = normalizeForSearch(text)
    .split(" ")
    .filter((word) => word.length > 0);

  return tokens.every((token) => words.some((word) => word.startsWith(token)));
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "ConstraintError"
  );
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

function mapPage<T, R>(page: Page<T>, map: (row: T) => R): Page<R> {
  return {
    items: page.items.map(map),
    nextCursor: page.nextCursor,
    total: page.total,
  };
}
