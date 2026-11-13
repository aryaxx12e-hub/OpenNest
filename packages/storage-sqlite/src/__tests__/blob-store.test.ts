// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
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
