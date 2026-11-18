// @vitest-environment node

import { randomUUID } from "node:crypto";
import { access, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  UnsafeKeyError,
  type BlobKey,
  type DomainError,
  idGenerator,
} from "@opennest/core";
import { afterEach, describe, expect, it } from "vitest";

import { FileSystemBlobStore } from "../index";
import { mapSqliteError } from "../errors";

const directories: string[] = [];

async function makeStore(): Promise<FileSystemBlobStore> {
  const root = await mkdtemp(path.join(tmpdir(), "opennest-sqlite-blobs-"));
  directories.push(root);

  return new FileSystemBlobStore({ rootDir: root });
}

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

describe("FileSystemBlobStore", () => {
  it("round-trips bytes and the MIME type", async () => {
    const store = await makeStore();
    const key = idGenerator(77)() as BlobKey;

    await store.put(key, new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }));

    const blob = await store.get(key);
    expect(blob?.type).toBe("image/png");
    expect(new Uint8Array(await (blob as Blob).arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3])
    );
    expect(await store.has(key)).toBe(true);
    expect(await store.usage()).toEqual({ bytes: 3, items: 1 });

    await store.delete(key);

    expect(await store.get(key)).toBeNull();
    expect(await store.has(key)).toBe(false);
    expect(await store.usage()).toEqual({ bytes: 0, items: 0 });
  });

  it("rejects unsafe keys before touching the filesystem", async () => {
    const store = await makeStore();
    const unsafe = [
      "../escape",
      "a/b",
      "a\\b",
      "..",
      "not-a-uuid",
      "ABCDEF00-0000-4000-8000-000000000000",
    ];

    for (const key of unsafe) {
      await expect(store.put(key as BlobKey, new Uint8Array([1]))).rejects.toBeInstanceOf(
        UnsafeKeyError
      );
      await expect(store.get(key as BlobKey)).rejects.toBeInstanceOf(UnsafeKeyError);
    }
  });

  it("purges blobs that are not referenced by the snapshot", async () => {
    const store = await makeStore();
    const nextKey = idGenerator(99);
    const kept = nextKey() as BlobKey;
    const orphan = nextKey() as BlobKey;

    await store.put(kept, new Uint8Array([1, 2]));
    await store.put(orphan, new Uint8Array([3, 4, 5]));

    const removed = await store.purgeOrphans([kept]);

    expect(removed).toBe(1);
    expect(await store.has(kept)).toBe(true);
    expect(await store.has(orphan)).toBe(false);
    expect(await store.usage()).toEqual({ bytes: 2, items: 1 });
  });

  it("removes orphan blobs, metadata, and stale temporary files", async () => {
    const store = await makeStore();
    const nextKey = idGenerator(120);
    const kept = nextKey() as BlobKey;
    const orphan = nextKey() as BlobKey;

    await store.put(kept, new Blob([new Uint8Array([1])], { type: "text/plain" }));
    await store.put(orphan, new Blob([new Uint8Array([2, 3])], { type: "text/plain" }));

    const directory = path.join(store.rootDir, "blobs", kept.slice(0, 2));
    const stale = path.join(directory, `.${kept}.${randomUUID()}.tmp`);
    const fresh = path.join(directory, `.${kept}.${randomUUID()}.tmp`);
    const now = Date.now();
    const old = new Date(now - 25 * 60 * 60 * 1000);

    await writeFile(stale, new Uint8Array([4]));
    await writeFile(fresh, new Uint8Array([5]));
    await utimes(stale, old, old);
    await utimes(fresh, new Date(now), new Date(now));

    const result = await store.reconcile([kept], {
      staleTempAgeMs: 24 * 60 * 60 * 1000,
      now: () => now,
    });

    expect(result).toEqual({
      removedBlobs: 1,
      removedMetadata: 1,
      removedTemporaryFiles: 1,
    });
    expect(await store.has(kept)).toBe(true);
    expect(await store.has(orphan)).toBe(false);
    await expect(access(stale)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(fresh)).resolves.toBeUndefined();
  });

  it("keeps referenced blobs and metadata while ignoring unrelated files", async () => {
    const store = await makeStore();
    const key = idGenerator(121)() as BlobKey;

    await store.put(key, new Blob([new Uint8Array([7])], { type: "text/plain" }));

    const directory = path.join(store.rootDir, "blobs", key.slice(0, 2));
    const unrelated = path.join(directory, "notes.txt");
    const metadata = path.join(directory, `${key}.meta.json`);
    await writeFile(unrelated, "keep");

    const result = await store.reconcile([key], { staleTempAgeMs: 0 });

    expect(result).toEqual({
      removedBlobs: 0,
      removedMetadata: 0,
      removedTemporaryFiles: 0,
    });
    expect(await store.has(key)).toBe(true);
    await expect(access(metadata)).resolves.toBeUndefined();
    await expect(access(unrelated)).resolves.toBeUndefined();
  });
});

describe("mapSqliteError", () => {
  it("maps known SQLite errcodes to domain errors", () => {
    const cases = [
      { errcode: 13, code: "quota_exceeded" },
      { errcode: 1555, code: "duplicate_id" },
      { errcode: 2067, code: "duplicate_tag_name" },
      { errcode: 787, code: "missing_reference" },
      { errcode: 9999, code: "corrupt_data" },
    ] as const;

    for (const testCase of cases) {
      const mapped = mapSqliteError({
        code: "ERR_SQLITE_ERROR",
        errcode: testCase.errcode,
        message: "constraint failed",
      }) as DomainError;

      expect(mapped.code).toBe(testCase.code);
    }
  });

  it("passes domain errors and foreign errors through untouched", () => {
    const domainError = new UnsafeKeyError("nope");
    expect(mapSqliteError(domainError)).toBe(domainError);

    const foreign = new Error("boom");
    expect(mapSqliteError(foreign)).toBe(foreign);
  });
});
