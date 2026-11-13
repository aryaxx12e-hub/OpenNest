import { createIdGenerator } from "../ids";
import type {
  BlobKey,
  FileId,
  FolderId,
  IsoDate,
  NoteId,
  TagId,
  WorkspaceId,
} from "../ids";
import type { Folder, Note, StoredFile, Tag, Workspace } from "../domain";
import type { BackupSnapshot, BlobStore } from "../ports";

export function idGenerator(seed = 1): () => string {
  let state = seed >>> 0 || 1;

  return createIdGenerator({
    getRandomValues<T extends ArrayBufferView>(array: T): T {
      const view = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
      for (let index = 0; index < view.length; index += 1) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        view[index] = (state >>> 24) & 0xff;
      }
      return array;
    },
  });
}

export function fixedClock(start = "2026-11-12T00:00:00.000Z"): () => IsoDate {
  const value = start as IsoDate;
  return () => value;
}

export function tickingClock(
  start = "2026-11-12T00:00:00.000Z",
  stepMs = 1000
): () => IsoDate {
  let current = Date.parse(start);

  return () => {
    const value = new Date(current).toISOString() as IsoDate;
    current += stepMs;
    return value;
  };
}

export function workspaceFixture(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: "11111111-1111-4111-8111-111111111111" as WorkspaceId,
    name: "Workspace",
    createdAt: "2026-11-12T00:00:00.000Z" as IsoDate,
    updatedAt: "2026-11-12T00:00:00.000Z" as IsoDate,
    ...overrides,
  };
}

export function folderFixture(overrides: Partial<Folder> = {}): Folder {
  return {
    id: "22222222-2222-4222-8222-222222222222" as FolderId,
    workspaceId: workspaceFixture().id,
    parentId: null,
    name: "Folder",
    createdAt: "2026-11-12T00:00:00.000Z" as IsoDate,
    updatedAt: "2026-11-12T00:00:00.000Z" as IsoDate,
    ...overrides,
  };
}

export function fileFixture(overrides: Partial<StoredFile> = {}): StoredFile {
  return {
    id: "33333333-3333-4333-8333-333333333333" as FileId,
    workspaceId: workspaceFixture().id,
    folderId: null,
    name: "laporan.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1024,
    blobKey: "44444444-4444-4444-8444-444444444444" as BlobKey,
    checksum: null,
    createdAt: "2026-11-12T00:00:00.000Z" as IsoDate,
    updatedAt: "2026-11-12T00:00:00.000Z" as IsoDate,
    ...overrides,
  };
}

export function noteFixture(overrides: Partial<Note> = {}): Note {
  return {
    id: "55555555-5555-4555-8555-555555555555" as NoteId,
    workspaceId: workspaceFixture().id,
    folderId: null,
    title: "Catatan",
    content: "",
    pinned: false,
    createdAt: "2026-11-12T00:00:00.000Z" as IsoDate,
    updatedAt: "2026-11-12T00:00:00.000Z" as IsoDate,
    ...overrides,
  };
}

export function tagFixture(overrides: Partial<Tag> = {}): Tag {
  return {
    id: "66666666-6666-4666-8666-666666666666" as TagId,
    workspaceId: workspaceFixture().id,
    name: "Kerja",
    color: null,
    createdAt: "2026-11-12T00:00:00.000Z" as IsoDate,
    ...overrides,
  };
}

export interface FakeBlobStore extends BlobStore {
  readonly entries: Map<string, Uint8Array>;
}

export function createFakeBlobStore(): FakeBlobStore {
  const entries = new Map<string, Uint8Array>();

  return {
    entries,
    async put(key, data) {
      const bytes =
        data instanceof Uint8Array
          ? new Uint8Array(data)
          : new Uint8Array(await data.arrayBuffer());
      entries.set(key, bytes);
    },
    async get(key) {
      const bytes = entries.get(key);
      if (bytes === undefined) {
        return null;
      }
      const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength));
      copy.set(bytes);
      return new Blob([copy]);
    },
    async delete(key) {
      entries.delete(key);
    },
    async has(key) {
      return entries.has(key);
    },
    async usage() {
      let bytes = 0;
      for (const value of entries.values()) {
        bytes += value.byteLength;
      }
      return { bytes, items: entries.size };
    },
    async purgeOrphans(knownKeys) {
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
}

export const HOSTILE_SEARCH_QUERIES: readonly string[] = Object.freeze([
  '"',
  "*",
  "()",
  "-",
  "NEAR",
  "OR",
  "AND",
  "NOT",
  "a:b",
  "a(b)",
  "belanja - bulanan",
  'a"b',
  '""',
  "^caret",
  "{a b}",
  "\\",
  "%",
  "_",
  "😀",
  "belanja OR roti",
  "NEAR(belanja bulanan)",
  "a".repeat(1_000),
]);

const SEARCH_WORKSPACE = "11111111-1111-4111-8111-111111111111";
const SEARCH_ROOT_FOLDER = "22222222-2222-4222-8222-222222222221";
const SEARCH_CHILD_FOLDER = "22222222-2222-4222-8222-222222222222";
const SEARCH_OTHER_FOLDER = "22222222-2222-4222-8222-222222222223";

export function searchCorpusSnapshot(): BackupSnapshot {
  const at = "2026-11-12T00:00:00.000Z" as IsoDate;
  const workspaceId = SEARCH_WORKSPACE as WorkspaceId;
  const root = SEARCH_ROOT_FOLDER as FolderId;
  const child = SEARCH_CHILD_FOLDER as FolderId;
  const other = SEARCH_OTHER_FOLDER as FolderId;
  const kerja = "66666666-6666-4666-8666-666666666601" as TagId;
  const penting = "66666666-6666-4666-8666-666666666602" as TagId;

  return structuredClone({
    snapshotVersion: 1,
    schemaVersion: 1,
    kind: "dexie",
    createdAt: at,
    workspace: {
      id: workspaceId,
      name: "Rumah",
      createdAt: at,
      updatedAt: at,
    },
    folders: [
      {
        id: root,
        workspaceId,
        parentId: null,
        name: "Arsip",
        createdAt: at,
        updatedAt: at,
      },
      {
        id: child,
        workspaceId,
        parentId: root,
        name: "Kerja",
        createdAt: at,
        updatedAt: at,
      },
      {
        id: other,
        workspaceId,
        parentId: null,
        name: "Pribadi",
        createdAt: at,
        updatedAt: at,
      },
    ],
    files: [
      {
        id: "33333333-3333-4333-8333-333333333301" as FileId,
        workspaceId,
        folderId: root,
        name: "belanja",
        mimeType: "text/plain",
        sizeBytes: 1,
        blobKey: "44444444-4444-4444-8444-444444444401" as BlobKey,
        checksum: null,
        createdAt: at,
        updatedAt: at,
      },
      {
        id: "33333333-3333-4333-8333-333333333302" as FileId,
        workspaceId,
        folderId: child,
        name: "belanja bulanan.pdf",
        mimeType: "application/pdf",
        sizeBytes: 2,
        blobKey: "44444444-4444-4444-8444-444444444402" as BlobKey,
        checksum: null,
        createdAt: at,
        updatedAt: at,
      },
      {
        id: "33333333-3333-4333-8333-333333333303" as FileId,
        workspaceId,
        folderId: root,
        name: "belanja.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1,
        blobKey: "44444444-4444-4444-8444-444444444403" as BlobKey,
        checksum: null,
        createdAt: at,
        updatedAt: at,
      },
      {
        id: "33333333-3333-4333-8333-333333333304" as FileId,
        workspaceId,
        folderId: child,
        name: "Catatan.txt",
        mimeType: "text/plain",
        sizeBytes: 1,
        blobKey: "44444444-4444-4444-8444-444444444404" as BlobKey,
        checksum: null,
        createdAt: at,
        updatedAt: at,
      },
      {
        id: "33333333-3333-4333-8333-333333333305" as FileId,
        workspaceId,
        folderId: null,
        name: "café menu.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1,
        blobKey: "44444444-4444-4444-8444-444444444405" as BlobKey,
        checksum: null,
        createdAt: at,
        updatedAt: at,
      },
      {
        id: "33333333-3333-4333-8333-333333333306" as FileId,
        workspaceId,
        folderId: null,
        name: "laporan tahunan.pdf",
        mimeType: "application/pdf",
        sizeBytes: 3,
        blobKey: "44444444-4444-4444-8444-444444444406" as BlobKey,
        checksum: null,
        createdAt: at,
        updatedAt: at,
      },
    ],
    notes: [
      {
        id: "55555555-5555-4555-8555-555555555501" as NoteId,
        workspaceId,
        folderId: null,
        title: "Belanja",
        content: "",
        pinned: false,
        createdAt: at,
        updatedAt: at,
      },
      {
        id: "55555555-5555-4555-8555-555555555502" as NoteId,
        workspaceId,
        folderId: child,
        title: "belanja",
        content: "",
        pinned: false,
        createdAt: at,
        updatedAt: at,
      },
      {
        id: "55555555-5555-4555-8555-555555555503" as NoteId,
        workspaceId,
        folderId: root,
        title: "BELANJA",
        content: "",
        pinned: false,
        createdAt: at,
        updatedAt: at,
      },
      {
        id: "55555555-5555-4555-8555-555555555504" as NoteId,
        workspaceId,
        folderId: child,
        title: "Belanja bulanan",
        content: "susu dan roti",
        pinned: false,
        createdAt: at,
        updatedAt: at,
      },
      {
        id: "55555555-5555-4555-8555-555555555505" as NoteId,
        workspaceId,
        folderId: null,
        title: "Catatan belanja",
        content: "",
        pinned: false,
        createdAt: at,
        updatedAt: at,
      },
      {
        id: "55555555-5555-4555-8555-555555555506" as NoteId,
        workspaceId,
        folderId: null,
        title: "Catatan",
        content: "daftar belanja bulanan",
        pinned: false,
        createdAt: at,
        updatedAt: at,
      },
      {
        id: "55555555-5555-4555-8555-555555555507" as NoteId,
        workspaceId,
        folderId: null,
        title: "Café résumé",
        content: "",
        pinned: false,
        createdAt: at,
        updatedAt: at,
      },
      {
        id: "55555555-5555-4555-8555-555555555508" as NoteId,
        workspaceId,
        folderId: null,
        title: "Ünïcode",
        content: "",
        pinned: false,
        createdAt: at,
        updatedAt: at,
      },
      {
        id: "55555555-5555-4555-8555-555555555509" as NoteId,
        workspaceId,
        folderId: null,
        title: "İstanbul",
        content: "",
        pinned: false,
        createdAt: at,
        updatedAt: at,
      },
      {
        id: "55555555-5555-4555-8555-55555555550a" as NoteId,
        workspaceId,
        folderId: null,
        title: "straße",
        content: "",
        pinned: false,
        createdAt: at,
        updatedAt: at,
      },
      {
        id: "55555555-5555-4555-8555-55555555550b" as NoteId,
        workspaceId,
        folderId: null,
        title: "ﬁle",
        content: "",
        pinned: false,
        createdAt: at,
        updatedAt: at,
      },
      {
        id: "55555555-5555-4555-8555-55555555550c" as NoteId,
        workspaceId,
        folderId: null,
        title: "belanja, bulanan",
        content: "",
        pinned: false,
        createdAt: at,
        updatedAt: at,
      },
      {
        id: "55555555-5555-4555-8555-55555555550d" as NoteId,
        workspaceId,
        folderId: null,
        title: "don't stop",
        content: "",
        pinned: false,
        createdAt: at,
        updatedAt: at,
      },
      {
        id: "55555555-5555-4555-8555-55555555550e" as NoteId,
        workspaceId,
        folderId: null,
        title: "foo-bar",
        content: "",
        pinned: false,
        createdAt: at,
        updatedAt: at,
      },
      {
        id: "55555555-5555-4555-8555-55555555550f" as NoteId,
        workspaceId,
        folderId: null,
        title: "Rencana",
        content: "belanja tahunan",
        pinned: false,
        createdAt: at,
        updatedAt: at,
      },
    ],
    tags: [
      {
        id: kerja,
        workspaceId,
        name: "kerja",
        color: null,
        createdAt: at,
      },
      {
        id: penting,
        workspaceId,
        name: "penting",
        color: "#ff0000",
        createdAt: at,
      },
    ],
    fileTags: [
      {
        fileId: "33333333-3333-4333-8333-333333333301" as FileId,
        tagId: kerja,
      },
      {
        fileId: "33333333-3333-4333-8333-333333333302" as FileId,
        tagId: kerja,
      },
      {
        fileId: "33333333-3333-4333-8333-333333333302" as FileId,
        tagId: penting,
      },
      {
        fileId: "33333333-3333-4333-8333-333333333304" as FileId,
        tagId: kerja,
      },
      {
        fileId: "33333333-3333-4333-8333-333333333306" as FileId,
        tagId: penting,
      },
    ],
    noteTags: [
      { noteId: "55555555-5555-4555-8555-555555555501" as NoteId, tagId: kerja },
      { noteId: "55555555-5555-4555-8555-555555555502" as NoteId, tagId: kerja },
      { noteId: "55555555-5555-4555-8555-555555555504" as NoteId, tagId: kerja },
      {
        noteId: "55555555-5555-4555-8555-555555555504" as NoteId,
        tagId: penting,
      },
      {
        noteId: "55555555-5555-4555-8555-555555555505" as NoteId,
        tagId: penting,
      },
      {
        noteId: "55555555-5555-4555-8555-55555555550d" as NoteId,
        tagId: kerja,
      },
      {
        noteId: "55555555-5555-4555-8555-55555555550f" as NoteId,
        tagId: penting,
      },
    ],
    noteLinks: [
      {
        sourceNoteId: "55555555-5555-4555-8555-555555555501" as NoteId,
        targetNoteId: "55555555-5555-4555-8555-555555555504" as NoteId,
      },
      {
        sourceNoteId: "55555555-5555-4555-8555-555555555504" as NoteId,
        targetNoteId: "55555555-5555-4555-8555-55555555550f" as NoteId,
      },
    ],
    blobs: [
      {
        key: "44444444-4444-4444-8444-444444444401" as BlobKey,
        mimeType: "text/plain",
        data: new Uint8Array([1]),
      },
      {
        key: "44444444-4444-4444-8444-444444444402" as BlobKey,
        mimeType: "application/pdf",
        data: new Uint8Array([1, 2]),
      },
      {
        key: "44444444-4444-4444-8444-444444444403" as BlobKey,
        mimeType: "application/pdf",
        data: new Uint8Array([3]),
      },
      {
        key: "44444444-4444-4444-8444-444444444404" as BlobKey,
        mimeType: "text/plain",
        data: new Uint8Array([4]),
      },
      {
        key: "44444444-4444-4444-8444-444444444405" as BlobKey,
        mimeType: "application/pdf",
        data: new Uint8Array([5]),
      },
      {
        key: "44444444-4444-4444-8444-444444444406" as BlobKey,
        mimeType: "application/pdf",
        data: new Uint8Array([6, 7, 8]),
      },
    ],
  });
}
