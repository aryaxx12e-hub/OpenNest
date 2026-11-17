import {
  NotFoundError,
  UnsupportedError,
  decodeCursor,
  encodeCursor,
  generateId,
  normalizeForSearch,
  searchTokens,
  type BackupSnapshot,
  type BlobStore,
  type FileRepository,
  type ListOptions,
  type Note,
  type NoteFilter,
  type NoteId,
  type NoteRepository,
  type Page,
  type SearchRepository,
  type StorageAdapter,
  type TransactionRunner,
  type WorkspaceId,
} from "@opennest/core";

import { bytesToHex } from "./bytes";
import {
  openBytes,
  openText,
  sealBytes,
  sealText,
  type EnvelopeContext,
  type WorkspaceCryptoContext,
} from "./envelope";
import { CryptoError } from "./errors";
import { getWebCrypto } from "./random";
import { createEncryptedSearch } from "./search";

const DEFAULT_LIMIT = 50;
const NOTE_PAGE_SIZE = 200;

export interface CreateEncryptedStorageOptions<T extends StorageAdapter> {
  base: T;
  context: WorkspaceCryptoContext;
}

export function createEncryptedStorage<T extends StorageAdapter = StorageAdapter>(
  options: CreateEncryptedStorageOptions<T>
): T {
  const { base, context } = options;

  function assertWorkspace(workspaceId: string): void {
    if (workspaceId !== context.workspaceId) {
      throw new CryptoError(
        "invalid_workspace_id",
        "Encrypted storage cannot access another workspace"
      );
    }
  }

  function noteContext(noteId: string): EnvelopeContext {
    return {
      workspaceId: context.workspaceId,
      purpose: "note-content",
      entityType: "note",
      entityId: noteId,
    };
  }

  function blobContext(blobKey: string): EnvelopeContext {
    return {
      workspaceId: context.workspaceId,
      purpose: "file-bytes",
      entityType: "blob",
      entityId: blobKey,
    };
  }

  async function encryptNote(noteId: string, content: string): Promise<string> {
    return sealText({
      context: noteContext(noteId),
      dek: context.dek,
      keyId: context.keyId,
      plaintext: content,
    });
  }

  async function decryptNote(raw: Note): Promise<Note> {
    if (raw.workspaceId !== context.workspaceId) {
      throw new CryptoError(
        "invalid_workspace_id",
        "The note belongs to another workspace"
      );
    }

    const content = await openText({
      context: noteContext(raw.id),
      dek: context.dek,
      keyId: context.keyId,
      envelope: raw.content,
    });

    return { ...raw, content };
  }

  const notes: NoteRepository = {
    async create(input) {
      assertWorkspace(input.workspaceId);

      const id = (input.id ?? generateId()) as NoteId;
      const content = await encryptNote(id, input.content ?? "");
      const raw = await base.notes.create({ ...input, id, content });

      return decryptNote(raw);
    },
    async get(id) {
      const raw = await base.notes.get(id);

      return raw === null ? null : decryptNote(raw);
    },
    async update(id, patch) {
      const raw = await base.notes.get(id);

      if (raw === null) {
        throw new NotFoundError("Note does not exist.");
      }

      assertWorkspace(raw.workspaceId);

      const next: Parameters<NoteRepository["update"]>[1] = { ...patch };

      if (patch.content !== undefined) {
        next.content = await encryptNote(id, patch.content);
      }

      return decryptNote(await base.notes.update(id, next));
    },
    async delete(id) {
      const raw = await base.notes.get(id);

      if (raw !== null) {
        assertWorkspace(raw.workspaceId);
      }

      await base.notes.delete(id);
    },
    async list(workspaceId, filter, options) {
      assertWorkspace(workspaceId);

      if (filter.text === undefined) {
        const page = await base.notes.list(workspaceId, filter, options);

        return {
          ...page,
          items: await Promise.all(page.items.map(decryptNote)),
        };
      }

      const rawNotes = await listAllRawNotes(workspaceId, withoutTextFilter(filter));
      const decrypted = await Promise.all(rawNotes.map(decryptNote));
      const tokens = searchTokens(filter.text);
      const matches =
        tokens.length === 0
          ? decrypted
          : decrypted.filter((note) =>
              matchesTokens(`${note.title} ${note.content}`, tokens)
            );

      return paginateNotes(matches, options);
    },
    setTags(id, tagIds) {
      return base.notes.setTags(id, tagIds);
    },
    tags(id) {
      return base.notes.tags(id);
    },
    setLinks(id, targetIds) {
      return base.notes.setLinks(id, targetIds);
    },
    links(id) {
      return base.notes.links(id);
    },
  };

  const files: FileRepository = {
    async create(input) {
      assertWorkspace(input.workspaceId);

      const blob = await base.blobs.get(input.blobKey);
      const checksum = blob === null ? null : await checksumOf(await bytesOf(blob));

      return base.files.create({ ...input, checksum });
    },
    get(id) {
      return base.files.get(id);
    },
    update(id, patch) {
      return base.files.update(id, patch);
    },
    delete(id) {
      return base.files.delete(id);
    },
    list(workspaceId, filter, options) {
      assertWorkspace(workspaceId);

      return base.files.list(workspaceId, filter, options);
    },
    setTags(id, tagIds) {
      return base.files.setTags(id, tagIds);
    },
    tags(id) {
      return base.files.tags(id);
    },
  };

  const blobs: BlobStore = {
    async put(key, data) {
      const sealed = await sealBytes({
        context: blobContext(key),
        dek: context.dek,
        keyId: context.keyId,
        plaintext: await bytesOf(data),
      });
      const type = data instanceof Blob ? data.type : "";

      await base.blobs.put(
        key,
        type.length === 0 ? sealed : new Blob([Uint8Array.from(sealed)], { type })
      );
    },
    async get(key) {
      const blob = await base.blobs.get(key);

      if (blob === null) {
        return null;
      }

      const plaintext = await openBytes({
        context: blobContext(key),
        dek: context.dek,
        keyId: context.keyId,
        envelope: await bytesOf(blob),
      });

      return new Blob([Uint8Array.from(plaintext)], { type: blob.type });
    },
    delete(key) {
      return base.blobs.delete(key);
    },
    has(key) {
      return base.blobs.has(key);
    },
    usage() {
      return base.blobs.usage();
    },
    purgeOrphans(knownKeys) {
      return base.blobs.purgeOrphans(knownKeys);
    },
  };

  const search: SearchRepository = createEncryptedSearch({
    workspaceId: context.workspaceId,
    baseSearch: base.search,
    baseNotes: base.notes,
    openNote: decryptNote,
  });

  const transaction: TransactionRunner = async () => {
    throw new UnsupportedError(
      "Encrypted storage does not support transactions.",
      "encrypted_transaction"
    );
  };

  const storage = {
    ...base,
    notes,
    files,
    search,
    blobs,
    transaction,
    async restore(snapshot: BackupSnapshot) {
      await base.restore(await encryptSnapshot(snapshot));
    },
  } as T;

  return storage;

  async function listAllRawNotes(
    workspaceId: WorkspaceId,
    filter: NoteFilter
  ): Promise<Note[]> {
    const notes: Note[] = [];
    let cursor: string | null = null;

    for (;;) {
      const page = await base.notes.list(workspaceId, filter, {
        limit: NOTE_PAGE_SIZE,
        ...(cursor === null ? {} : { cursor }),
      });
      notes.push(...page.items);

      if (page.nextCursor === null || page.nextCursor === cursor) {
        return notes;
      }

      cursor = page.nextCursor;
    }
  }

  async function encryptSnapshot(snapshot: BackupSnapshot): Promise<BackupSnapshot> {
    const workspaceId = context.workspaceId as WorkspaceId;
    const checksums = new Map<string, string>();
    const encryptedBlobs: BackupSnapshot["blobs"] = [];

    for (const blob of snapshot.blobs) {
      const data = await sealBytes({
        context: blobContext(blob.key),
        dek: context.dek,
        keyId: context.keyId,
        plaintext: blob.data,
      });
      checksums.set(blob.key, await checksumOf(data));
      encryptedBlobs.push({ ...blob, data });
    }

    const encryptedNotes: Note[] = [];

    for (const note of snapshot.notes) {
      encryptedNotes.push({
        ...note,
        workspaceId,
        content: await encryptNote(note.id, note.content),
      });
    }

    return {
      ...snapshot,
      blobEncoding: "encrypted",
      workspace: { ...snapshot.workspace, id: workspaceId },
      folders: snapshot.folders.map((folder) => ({ ...folder, workspaceId })),
      files: snapshot.files.map((file) => ({
        ...file,
        workspaceId,
        checksum: checksums.get(file.blobKey) ?? null,
      })),
      notes: encryptedNotes,
      tags: snapshot.tags.map((tag) => ({ ...tag, workspaceId })),
      blobs: encryptedBlobs,
    };
  }
}

async function checksumOf(data: Uint8Array): Promise<string> {
  const digest = await getWebCrypto().subtle.digest("SHA-256", Uint8Array.from(data));

  return bytesToHex(new Uint8Array(digest));
}

async function bytesOf(data: Blob | Uint8Array): Promise<Uint8Array> {
  return data instanceof Uint8Array
    ? Uint8Array.from(data)
    : new Uint8Array(await data.arrayBuffer());
}

function withoutTextFilter(filter: NoteFilter): NoteFilter {
  const next: NoteFilter = {};

  if (filter.folderId !== undefined) {
    next.folderId = filter.folderId;
  }
  if (filter.tagIds !== undefined) {
    next.tagIds = filter.tagIds;
  }
  if (filter.pinned !== undefined) {
    next.pinned = filter.pinned;
  }

  return next;
}

function paginateNotes(
  notes: readonly Note[],
  options: ListOptions | undefined
): Page<Note> {
  const limit = options?.limit ?? DEFAULT_LIMIT;
  const direction = options?.direction ?? "asc";
  const sign = direction === "asc" ? 1 : -1;
  const sort = options?.sort ?? "name";
  const valueOf = (note: Note): string => {
    if (sort === "createdAt") {
      return note.createdAt;
    }
    if (sort === "updatedAt") {
      return note.updatedAt;
    }

    return normalizeForSearch(note.title);
  };
  const sorted = [...notes].sort((left, right) => {
    const a = valueOf(left);
    const b = valueOf(right);

    if (a !== b) {
      return a < b ? -sign : sign;
    }

    return left.id < right.id ? -sign : left.id > right.id ? sign : 0;
  });
  const start =
    options?.cursor === undefined || options.cursor === null
      ? 0
      : (() => {
          const [cursorValue, cursorId] = decodeCursor(options.cursor);
          const index = sorted.findIndex(
            (note) => valueOf(note) === cursorValue && note.id === cursorId
          );

          return index === -1 ? sorted.length : index + 1;
        })();
  const items = sorted.slice(start, start + limit);
  const last = items.at(-1);
  const nextCursor =
    last !== undefined && start + limit < sorted.length
      ? encodeCursor([valueOf(last), last.id])
      : null;

  return { items, nextCursor, total: sorted.length };
}

function matchesTokens(text: string, tokens: string[]): boolean {
  const words = normalizeForSearch(text)
    .split(" ")
    .filter((word) => word.length > 0);

  return tokens.every((token) => words.some((word) => word.startsWith(token)));
}
