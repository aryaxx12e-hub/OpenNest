import type { Folder, Note, NoteLink, StoredFile, Tag, Workspace } from "../domain";
import {
  ConflictError,
  ConstraintError,
  NotFoundError,
  StorageError,
  ValidationError,
} from "../errors";
import type { FileId, FolderId, IsoDate, NoteId, TagId, WorkspaceId } from "../ids";
import { generateId } from "../ids";
import type {
  BackupSnapshot,
  BlobStore,
  FileRepository,
  FolderRepository,
  ListOptions,
  NoteRepository,
  Page,
  SearchHit,
  SearchRepository,
  StorageAdapter,
  TagRepository,
  WorkspaceRepository,
} from "../ports";
import { normalizeForSearch, normalizeTagName, searchTokens } from "../rules";
import { decodeCursor, encodeCursor } from "../cursor";

const DEFAULT_LIMIT = 50;

export interface MemoryStorageConfig {
  idGenerator?: () => string;
  defaultWorkspaceName?: string;
}

interface State {
  workspaces: Workspace[];
  folders: Folder[];
  files: StoredFile[];
  notes: Note[];
  tags: Tag[];
  fileTags: Array<{ fileId: FileId; tagId: TagId }>;
  noteTags: Array<{ noteId: NoteId; tagId: TagId }>;
  noteLinks: NoteLink[];
}

function cloneState(state: State): State {
  return {
    workspaces: state.workspaces.map((row) => ({ ...row })),
    folders: state.folders.map((row) => ({ ...row })),
    files: state.files.map((row) => ({ ...row })),
    notes: state.notes.map((row) => ({ ...row })),
    tags: state.tags.map((row) => ({ ...row })),
    fileTags: state.fileTags.map((row) => ({ ...row })),
    noteTags: state.noteTags.map((row) => ({ ...row })),
    noteLinks: state.noteLinks.map((row) => ({ ...row })),
  };
}

function requireAt(at: IsoDate | undefined): IsoDate {
  if (at === undefined) {
    throw new ValidationError(
      "A timestamp is required. Adapters never read the clock; the service supplies it."
    );
  }

  return at;
}

function laterOf(left: IsoDate, right: IsoDate): IsoDate {
  return left > right ? left : right;
}

function paginate<T>(
  rows: T[],
  options: ListOptions | undefined,
  valueOf: (row: T) => string,
  idOf: (row: T) => string
): Page<T> {
  const limit = options?.limit ?? DEFAULT_LIMIT;
  const direction = options?.direction ?? "asc";
  const sign = direction === "asc" ? 1 : -1;

  const sorted = [...rows].sort((left, right) => {
    const a = valueOf(left);
    const b = valueOf(right);
    if (a !== b) {
      return a < b ? -sign : sign;
    }
    const leftId = idOf(left);
    const rightId = idOf(right);
    return leftId < rightId ? -sign : leftId > rightId ? sign : 0;
  });

  const start =
    options?.cursor === undefined || options.cursor === null
      ? 0
      : (() => {
          const [cursorValue, cursorId] = decodeCursor(options.cursor);
          const index = sorted.findIndex(
            (row) => valueOf(row) === cursorValue && idOf(row) === cursorId
          );
          return index === -1 ? sorted.length : index + 1;
        })();

  const items = sorted.slice(start, start + limit);
  const last = items.at(-1);
  const nextCursor =
    last !== undefined && start + limit < sorted.length
      ? encodeCursor([valueOf(last), idOf(last)])
      : null;

  return { items, nextCursor, total: sorted.length };
}

export function createMemoryStorage(config: MemoryStorageConfig = {}): StorageAdapter {
  const nextId = config.idGenerator ?? generateId;
  const defaultWorkspaceName = config.defaultWorkspaceName ?? "Workspace";
  let state: State = {
    workspaces: [],
    folders: [],
    files: [],
    notes: [],
    tags: [],
    fileTags: [],
    noteTags: [],
    noteLinks: [],
  };
  let closed = false;

  function guard(): void {
    if (closed) {
      throw new StorageError("The storage adapter is closed.", "closed");
    }
  }

  const workspaces: WorkspaceRepository = {
    async get(id) {
      guard();
      return state.workspaces.find((row) => row.id === id) ?? null;
    },
    async list() {
      guard();
      return state.workspaces.map((row) => ({ ...row }));
    },
    async create(input) {
      guard();
      const at = requireAt(input.at);
      const row: Workspace = {
        id: nextId() as WorkspaceId,
        name: input.name,
        createdAt: at,
        updatedAt: at,
      };
      state.workspaces.push(row);
      return { ...row };
    },
    async update(id, patch) {
      guard();
      const row = state.workspaces.find((candidate) => candidate.id === id);
      if (row === undefined) {
        throw new NotFoundError("Workspace does not exist.");
      }
      const at = requireAt(patch.at);
      row.name = patch.name;
      row.updatedAt = laterOf(at, row.updatedAt);
      return { ...row };
    },
    async delete(id) {
      guard();
      if (!state.workspaces.some((row) => row.id === id)) {
        throw new NotFoundError("Workspace does not exist.");
      }
      state.workspaces = state.workspaces.filter((row) => row.id !== id);
      state.folders = state.folders.filter((row) => row.workspaceId !== id);
      state.files = state.files.filter((row) => row.workspaceId !== id);
      state.notes = state.notes.filter((row) => row.workspaceId !== id);
      state.tags = state.tags.filter((row) => row.workspaceId !== id);
      const fileIds = new Set<string>(state.files.map((row) => row.id));
      const noteIds = new Set<string>(state.notes.map((row) => row.id));
      const tagIds = new Set<string>(state.tags.map((row) => row.id));
      state.fileTags = state.fileTags.filter(
        (row) => fileIds.has(row.fileId) && tagIds.has(row.tagId)
      );
      state.noteTags = state.noteTags.filter(
        (row) => noteIds.has(row.noteId) && tagIds.has(row.tagId)
      );
      state.noteLinks = state.noteLinks.filter(
        (row) => noteIds.has(row.sourceNoteId) && noteIds.has(row.targetNoteId)
      );
    },
    async ensureWorkspace(input) {
      guard();
      if (state.workspaces.length > 1) {
        throw new ConstraintError(
          "More than one workspace exists; refusing to guess which to use.",
          "multiple_workspaces"
        );
      }

      const existing = state.workspaces[0];

      if (existing !== undefined) {
        return { ...existing };
      }

      const at = requireAt(input?.at);
      const row: Workspace = {
        id: nextId() as WorkspaceId,
        name: input?.name ?? defaultWorkspaceName,
        createdAt: at,
        updatedAt: at,
      };
      state.workspaces.push(row);
      return { ...row };
    },
  };

  function subtreeIds(folderId: FolderId): Set<string> {
    const ids = new Set<string>([folderId]);
    let changed = true;

    while (changed) {
      changed = false;
      for (const folder of state.folders) {
        if (folder.parentId !== null && ids.has(folder.parentId) && !ids.has(folder.id)) {
          ids.add(folder.id);
          changed = true;
        }
      }
    }

    return ids;
  }

  const folders: FolderRepository = {
    async create(input) {
      guard();
      const at = requireAt(input.at);
      if (input.parentId !== null) {
        const parent = state.folders.find((row) => row.id === input.parentId);
        if (parent === undefined) {
          throw new NotFoundError("Parent folder does not exist.");
        }
      }
      const row: Folder = {
        id: nextId() as FolderId,
        workspaceId: input.workspaceId,
        parentId: input.parentId,
        name: input.name,
        createdAt: at,
        updatedAt: at,
      };
      state.folders.push(row);
      return { ...row };
    },
    async get(id) {
      guard();
      const row = state.folders.find((candidate) => candidate.id === id);
      return row === undefined ? null : { ...row };
    },
    async update(id, patch) {
      guard();
      const row = state.folders.find((candidate) => candidate.id === id);
      if (row === undefined) {
        throw new NotFoundError("Folder does not exist.");
      }
      const at = requireAt(patch.at);
      if (patch.name !== undefined) {
        row.name = patch.name;
      }
      if (patch.parentId !== undefined) {
        row.parentId = patch.parentId;
      }
      row.updatedAt = laterOf(at, row.updatedAt);
      return { ...row };
    },
    async delete(id) {
      guard();
      if (!state.folders.some((row) => row.id === id)) {
        throw new NotFoundError("Folder does not exist.");
      }
      state.folders = state.folders.filter((row) => row.id !== id);
      for (const folder of state.folders) {
        if (folder.parentId === id) {
          folder.parentId = null;
        }
      }
      for (const file of state.files) {
        if (file.folderId === id) {
          file.folderId = null;
        }
      }
      for (const note of state.notes) {
        if (note.folderId === id) {
          note.folderId = null;
        }
      }
    },
    async list(workspaceId, options) {
      guard();
      const rows = state.folders.filter((row) => row.workspaceId === workspaceId);
      const sort = options?.sort ?? "name";
      const valueOf = (row: Folder) =>
        sort === "name" ? normalizeForSearch(row.name) : row[sort];
      return paginate(rows, options, valueOf, (row) => row.id);
    },
    async listChildren(workspaceId, parentId) {
      guard();
      return state.folders
        .filter((row) => row.workspaceId === workspaceId && row.parentId === parentId)
        .map((row) => ({ ...row }));
    },
    async ancestors(id) {
      guard();
      const chain: Folder[] = [];
      let cursor = state.folders.find((row) => row.id === id)?.parentId ?? null;

      while (cursor !== null) {
        const parent = state.folders.find((row) => row.id === cursor);
        if (parent === undefined) {
          break;
        }
        chain.unshift({ ...parent });
        cursor = parent.parentId;
      }

      return chain;
    },
    async descendants(id) {
      guard();
      const ids = subtreeIds(id);
      ids.delete(id);
      return state.folders.filter((row) => ids.has(row.id)).map((row) => ({ ...row }));
    },
  };

  function fileTagIds(fileId: FileId): TagId[] {
    return state.fileTags.filter((row) => row.fileId === fileId).map((row) => row.tagId);
  }

  function noteTagIds(noteId: NoteId): TagId[] {
    return state.noteTags.filter((row) => row.noteId === noteId).map((row) => row.tagId);
  }

  const files: FileRepository = {
    async create(input) {
      guard();
      const at = requireAt(input.at);
      const row: StoredFile = {
        id: nextId() as FileId,
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
      state.files.push(row);
      return { ...row };
    },
    async get(id) {
      guard();
      const row = state.files.find((candidate) => candidate.id === id);
      return row === undefined ? null : { ...row };
    },
    async update(id, patch) {
      guard();
      const row = state.files.find((candidate) => candidate.id === id);
      if (row === undefined) {
        throw new NotFoundError("File does not exist.");
      }
      const at = requireAt(patch.at);
      if (patch.name !== undefined) {
        row.name = patch.name;
      }
      if (patch.folderId !== undefined) {
        row.folderId = patch.folderId;
      }
      row.updatedAt = laterOf(at, row.updatedAt);
      return { ...row };
    },
    async delete(id) {
      guard();
      if (!state.files.some((row) => row.id === id)) {
        throw new NotFoundError("File does not exist.");
      }
      state.files = state.files.filter((row) => row.id !== id);
      state.fileTags = state.fileTags.filter((row) => row.fileId !== id);
    },
    async list(workspaceId, filter, options) {
      guard();
      let rows = state.files.filter((row) => row.workspaceId === workspaceId);

      if (filter.folderId === null) {
        rows = rows.filter((row) => row.folderId === null);
      } else if (filter.folderId !== undefined) {
        const ids = subtreeIds(filter.folderId);
        rows = rows.filter((row) => row.folderId !== null && ids.has(row.folderId));
      }

      if (filter.mimeTypes !== undefined) {
        const allowed = new Set(filter.mimeTypes);
        rows = rows.filter((row) => row.mimeType !== null && allowed.has(row.mimeType));
      }

      if (filter.tagIds !== undefined && filter.tagIds.length > 0) {
        const required = new Set<string>(filter.tagIds);
        rows = rows.filter((row) => {
          const owned = fileTagIds(row.id);
          return [...required].every((tagId) => owned.includes(tagId as TagId));
        });
      }

      if (filter.text !== undefined) {
        const tokens = searchTokens(filter.text);
        if (tokens.length > 0) {
          rows = rows.filter((row) => matchesTokens(row.name, tokens));
        }
      }

      const sort = options?.sort ?? "name";
      const valueOf = (row: StoredFile) =>
        sort === "name" ? normalizeForSearch(row.name) : row[sort];
      return paginate(rows, options, valueOf, (row) => row.id);
    },
    async setTags(id, tagIds) {
      guard();
      if (!state.files.some((row) => row.id === id)) {
        throw new NotFoundError("File does not exist.");
      }
      const unique = [...new Set(tagIds)];
      state.fileTags = state.fileTags.filter((row) => row.fileId !== id);
      for (const tagId of unique) {
        state.fileTags.push({ fileId: id, tagId });
      }
    },
    async tags(id) {
      guard();
      const ids = new Set<string>(fileTagIds(id));
      return state.tags.filter((row) => ids.has(row.id)).map((row) => ({ ...row }));
    },
  };

  const notes: NoteRepository = {
    async create(input) {
      guard();
      const at = requireAt(input.at);
      const id = input.id ?? (nextId() as NoteId);

      if (state.notes.some((candidate) => candidate.id === id)) {
        throw new ConflictError("A note with that id already exists.", "duplicate_id");
      }

      const row: Note = {
        id,
        workspaceId: input.workspaceId,
        folderId: input.folderId,
        title: input.title,
        content: input.content ?? "",
        pinned: input.pinned ?? false,
        createdAt: at,
        updatedAt: at,
      };
      state.notes.push(row);
      return { ...row };
    },
    async get(id) {
      guard();
      const row = state.notes.find((candidate) => candidate.id === id);
      return row === undefined ? null : { ...row };
    },
    async update(id, patch) {
      guard();
      const row = state.notes.find((candidate) => candidate.id === id);
      if (row === undefined) {
        throw new NotFoundError("Note does not exist.");
      }
      const at = requireAt(patch.at);
      if (patch.title !== undefined) {
        row.title = patch.title;
      }
      if (patch.content !== undefined) {
        row.content = patch.content;
      }
      if (patch.folderId !== undefined) {
        row.folderId = patch.folderId;
      }
      if (patch.pinned !== undefined) {
        row.pinned = patch.pinned;
      }
      row.updatedAt = laterOf(at, row.updatedAt);
      return { ...row };
    },
    async delete(id) {
      guard();
      if (!state.notes.some((row) => row.id === id)) {
        throw new NotFoundError("Note does not exist.");
      }
      state.notes = state.notes.filter((row) => row.id !== id);
      state.noteTags = state.noteTags.filter((row) => row.noteId !== id);
      state.noteLinks = state.noteLinks.filter(
        (row) => row.sourceNoteId !== id && row.targetNoteId !== id
      );
    },
    async list(workspaceId, filter, options) {
      guard();
      let rows = state.notes.filter((row) => row.workspaceId === workspaceId);

      if (filter.folderId === null) {
        rows = rows.filter((row) => row.folderId === null);
      } else if (filter.folderId !== undefined) {
        const ids = subtreeIds(filter.folderId);
        rows = rows.filter((row) => row.folderId !== null && ids.has(row.folderId));
      }

      if (filter.pinned !== undefined) {
        rows = rows.filter((row) => row.pinned === filter.pinned);
      }

      if (filter.tagIds !== undefined && filter.tagIds.length > 0) {
        const required = new Set<string>(filter.tagIds);
        rows = rows.filter((row) => {
          const owned = noteTagIds(row.id);
          return [...required].every((tagId) => owned.includes(tagId as TagId));
        });
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
      const valueOf = (row: Note) =>
        sort === "name" ? normalizeForSearch(row.title) : row[sort];
      return paginate(rows, options, valueOf, (row) => row.id);
    },
    async setTags(id, tagIds) {
      guard();
      if (!state.notes.some((row) => row.id === id)) {
        throw new NotFoundError("Note does not exist.");
      }
      const unique = [...new Set(tagIds)];
      state.noteTags = state.noteTags.filter((row) => row.noteId !== id);
      for (const tagId of unique) {
        state.noteTags.push({ noteId: id, tagId });
      }
    },
    async tags(id) {
      guard();
      const ids = new Set<string>(noteTagIds(id));
      return state.tags.filter((row) => ids.has(row.id)).map((row) => ({ ...row }));
    },
    async setLinks(id, targetIds) {
      guard();
      if (!state.notes.some((row) => row.id === id)) {
        throw new NotFoundError("Note does not exist.");
      }
      const unique = [...new Set(targetIds)];

      for (const targetId of unique) {
        if (targetId === id) {
          throw new ConstraintError("A note must not link to itself.", "self_link");
        }
      }

      state.noteLinks = state.noteLinks.filter((row) => row.sourceNoteId !== id);
      for (const targetId of unique) {
        state.noteLinks.push({ sourceNoteId: id, targetNoteId: targetId });
      }
    },
    async links(id) {
      guard();
      return state.noteLinks
        .filter((row) => row.sourceNoteId === id)
        .map((row) => ({ ...row }));
    },
  };

  const tags: TagRepository = {
    async create(input) {
      guard();
      const at = requireAt(input.at);
      const { display } = normalizeTagName(input.name);
      const row: Tag = {
        id: nextId() as TagId,
        workspaceId: input.workspaceId,
        name: display,
        color: input.color ?? null,
        createdAt: at,
      };
      state.tags.push(row);
      return { ...row };
    },
    async get(id) {
      guard();
      const row = state.tags.find((candidate) => candidate.id === id);
      return row === undefined ? null : { ...row };
    },
    async update(id, patch) {
      guard();
      const row = state.tags.find((candidate) => candidate.id === id);
      if (row === undefined) {
        throw new NotFoundError("Tag does not exist.");
      }
      if (patch.name !== undefined) {
        row.name = normalizeTagName(patch.name).display;
      }
      if (patch.color !== undefined) {
        row.color = patch.color;
      }
      return { ...row };
    },
    async delete(id) {
      guard();
      if (!state.tags.some((row) => row.id === id)) {
        throw new NotFoundError("Tag does not exist.");
      }
      state.tags = state.tags.filter((row) => row.id !== id);
      state.fileTags = state.fileTags.filter((row) => row.tagId !== id);
      state.noteTags = state.noteTags.filter((row) => row.tagId !== id);
    },
    async list(workspaceId, options) {
      guard();
      const rows = state.tags.filter((row) => row.workspaceId === workspaceId);
      const sort = options?.sort ?? "name";
      const valueOf = (row: Tag) =>
        sort === "name" ? normalizeForSearch(row.name) : row.createdAt;
      return paginate(rows, options, valueOf, (row) => row.id);
    },
    async findByName(workspaceId, key) {
      guard();
      const row = state.tags.find(
        (candidate) =>
          candidate.workspaceId === workspaceId &&
          normalizeTagName(candidate.name).key === key
      );
      return row === undefined ? null : { ...row };
    },
  };

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

  const search: SearchRepository = {
    async search(query) {
      guard();
      const tokens = searchTokens(query.text);
      if (tokens.length === 0) {
        return [];
      }
      const foldedQuery = normalizeForSearch(query.text);
      const kinds = new Set(query.kinds ?? ["file", "note"]);
      const hits: SearchHit[] = [];

      if (kinds.has("file")) {
        let rows = state.files.filter((row) => row.workspaceId === query.workspaceId);
        if (query.folderId === null) {
          rows = rows.filter((row) => row.folderId === null);
        } else if (query.folderId !== undefined) {
          const ids = subtreeIds(query.folderId);
          rows = rows.filter((row) => row.folderId !== null && ids.has(row.folderId));
        }
        if (query.tagIds !== undefined && query.tagIds.length > 0) {
          const required = new Set<string>(query.tagIds);
          rows = rows.filter((row) => {
            const owned = fileTagIds(row.id);
            return [...required].every((tagId) => owned.includes(tagId as TagId));
          });
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
        let rows = state.notes.filter((row) => row.workspaceId === query.workspaceId);
        if (query.folderId === null) {
          rows = rows.filter((row) => row.folderId === null);
        } else if (query.folderId !== undefined) {
          const ids = subtreeIds(query.folderId);
          rows = rows.filter((row) => row.folderId !== null && ids.has(row.folderId));
        }
        if (query.tagIds !== undefined && query.tagIds.length > 0) {
          const required = new Set<string>(query.tagIds);
          rows = rows.filter((row) => {
            const owned = noteTagIds(row.id);
            return [...required].every((tagId) => owned.includes(tagId as TagId));
          });
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
    },
    async reindexAll() {
      guard();
      return undefined;
    },
  };

  const blobs: BlobStore = (() => {
    const entries = new Map<string, { bytes: Uint8Array; type: string }>();
    return {
      async put(key, data) {
        guard();
        const bytes =
          data instanceof Uint8Array
            ? new Uint8Array(data)
            : new Uint8Array(await data.arrayBuffer());
        const type = data instanceof Uint8Array ? "" : data.type;
        entries.set(key, { bytes, type });
      },
      async get(key) {
        guard();
        const entry = entries.get(key);
        if (entry === undefined) {
          return null;
        }
        const copy = new Uint8Array(new ArrayBuffer(entry.bytes.byteLength));
        copy.set(entry.bytes);
        return new Blob([copy], { type: entry.type });
      },
      async delete(key) {
        guard();
        entries.delete(key);
      },
      async has(key) {
        guard();
        return entries.has(key);
      },
      async usage() {
        guard();
        let bytes = 0;
        for (const value of entries.values()) {
          bytes += value.bytes.byteLength;
        }
        return { bytes, items: entries.size };
      },
      async purgeOrphans(knownKeys) {
        guard();
        const known = new Set<string>(knownKeys);
        let removed = 0;
        for (const key of [...entries.keys()]) {
          if (!known.has(key)) {
            entries.delete(key);
            removed += 1;
          }
        }
        return removed;
      },
    };
  })();

  const adapter: StorageAdapter = {
    kind: "dexie",
    schemaVersion: 1,
    workspaces,
    folders,
    files,
    notes,
    tags,
    search,
    blobs,
    async transaction(work) {
      guard();
      const snapshot = cloneState(state);
      try {
        return await work(adapter);
      } catch (error) {
        state = snapshot;
        throw error;
      }
    },
    async init() {
      guard();
      return undefined;
    },
    async close() {
      if (closed) {
        return;
      }
      closed = true;
    },
    async reset() {
      guard();
      state = {
        workspaces: [],
        folders: [],
        files: [],
        notes: [],
        tags: [],
        fileTags: [],
        noteTags: [],
        noteLinks: [],
      };
      await blobs.purgeOrphans([]);
    },
    async restore(snapshot: BackupSnapshot) {
      guard();
      if (snapshot.snapshotVersion !== 1) {
        throw new ValidationError("Unsupported snapshot version.");
      }
      const next: State = {
        workspaces: [snapshot.workspace].map((row) => ({ ...row })),
        folders: snapshot.folders.map((row) => ({ ...row })),
        files: snapshot.files.map((row) => ({ ...row })),
        notes: snapshot.notes.map((row) => ({ ...row })),
        tags: snapshot.tags.map((row) => ({ ...row })),
        fileTags: snapshot.fileTags.map((row) => ({ ...row })),
        noteTags: snapshot.noteTags.map((row) => ({ ...row })),
        noteLinks: snapshot.noteLinks.map((row) => ({ ...row })),
      };
      state = next;
      await blobs.purgeOrphans([]);
      for (const blob of snapshot.blobs) {
        await blobs.put(blob.key, blob.data);
      }
    },
  };

  return adapter;
}
