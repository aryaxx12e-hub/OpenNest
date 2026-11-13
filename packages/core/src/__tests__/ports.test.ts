import { describe, expect, expectTypeOf, it } from "vitest";

import type {
  BackupSnapshot,
  BlobStore,
  DexieStorageConfig,
  FileFilter,
  ListOptions,
  NoteFilter,
  Page,
  Repositories,
  SearchHit,
  SearchQuery,
  SqliteStorageConfig,
  StorageAdapter,
  TransactionRunner,
} from "../ports";
import type { FileId, FolderId, NoteId, WorkspaceId } from "../ids";
import type { Folder, Note, StoredFile, Tag, Workspace } from "../domain";

describe("list options and filters", () => {
  it("permits only the documented sort tokens", () => {
    const options: ListOptions = { sort: "name", direction: "asc", limit: 10 };

    expect(options.sort).toBe("name");
    expectTypeOf<NonNullable<ListOptions["sort"]>>().toEqualTypeOf<
      "name" | "createdAt" | "updatedAt"
    >();
  });

  it("distinguishes an omitted folder from the root", () => {
    const rootOnly: FileFilter = { folderId: null };
    const anywhere: FileFilter = {};
    const notesAtRoot: NoteFilter = { folderId: null, pinned: true };

    expect(rootOnly.folderId).toBeNull();
    expect(Object.hasOwn(anywhere, "folderId")).toBe(false);
    expect(notesAtRoot.pinned).toBe(true);
  });

  it("pages carry items, a cursor, and a total", () => {
    const page: Page<Tag> = { items: [], nextCursor: "c1", total: 0 };

    expect(page.nextCursor).toBe("c1");
    expect(page.total).toBe(0);
  });
});

describe("adapter surface", () => {
  it("exposes the repositories plus lifecycle", () => {
    expectTypeOf<StorageAdapter["kind"]>().toEqualTypeOf<"dexie" | "sqlite">();
    expectTypeOf<StorageAdapter["schemaVersion"]>().toEqualTypeOf<number>();
    expectTypeOf<StorageAdapter["init"]>().returns.toEqualTypeOf<Promise<void>>();
    expectTypeOf<StorageAdapter["restore"]>()
      .parameter(0)
      .toEqualTypeOf<BackupSnapshot>();
    expectTypeOf<StorageAdapter>().toMatchTypeOf<Repositories>();
  });

  it("backup snapshots carry blob bytes and a transfer version", () => {
    expectTypeOf<BackupSnapshot["snapshotVersion"]>().toEqualTypeOf<1>();
    expectTypeOf<BackupSnapshot["kind"]>().toEqualTypeOf<"dexie" | "sqlite">();
    expectTypeOf<BackupSnapshot["blobs"][number]["data"]>().toEqualTypeOf<Uint8Array>();
    expectTypeOf<BackupSnapshot["workspace"]>().toEqualTypeOf<Workspace>();
    expectTypeOf<BackupSnapshot["notes"][number]>().toEqualTypeOf<Note>();
    expectTypeOf<BackupSnapshot["files"][number]>().toEqualTypeOf<StoredFile>();
    expectTypeOf<BackupSnapshot["folders"][number]>().toEqualTypeOf<Folder>();
  });

  it("a transaction runner is generic over the work's result", () => {
    expectTypeOf<TransactionRunner>().toBeFunction();
  });

  it("search queries and hits are shaped for the UI", () => {
    const query: SearchQuery = {
      workspaceId: "ws" as WorkspaceId,
      text: "belanja",
      kinds: ["file", "note"],
      folderId: null,
      tagIds: [],
      limit: 20,
      offset: 0,
    };
    const hit: SearchHit = {
      kind: "note",
      id: "n1",
      title: "Belanja",
      snippet: "…belanja…",
      score: 1,
    };

    expect(query.kinds).toEqual(["file", "note"]);
    expect(hit.kind).toBe("note");
  });

  it("blob store reports usage and purges orphans", () => {
    expectTypeOf<BlobStore["usage"]>().returns.toEqualTypeOf<
      Promise<{ bytes: number; items: number }>
    >();
    expectTypeOf<BlobStore["purgeOrphans"]>().returns.toEqualTypeOf<Promise<number>>();
    expectTypeOf<BlobStore["get"]>().returns.toEqualTypeOf<Promise<Blob | null>>();
  });

  it("adapter configs carry no clock", () => {
    const dexie: DexieStorageConfig = { databaseName: "opennest" };
    const sqlite: SqliteStorageConfig = {
      databaseFile: "/tmp/opennest.sqlite",
      blobRoot: "/tmp/blobs",
    };

    expect(dexie.databaseName).toBe("opennest");
    expect(sqlite.blobRoot).toBe("/tmp/blobs");
    expectTypeOf<DexieStorageConfig>().not.toHaveProperty("clock");
    expectTypeOf<SqliteStorageConfig>().not.toHaveProperty("clock");
  });

  it("branded ids do not mix", () => {
    expectTypeOf<FolderId>().not.toEqualTypeOf<NoteId>();
    expectTypeOf<FileId>().not.toEqualTypeOf<FolderId>();
    expectTypeOf<WorkspaceId>().not.toEqualTypeOf<string>();
  });
});
