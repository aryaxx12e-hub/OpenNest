import "fake-indexeddb/auto";

import { describe, expect, it } from "vitest";

import { DomainError, NotFoundError, StorageError } from "@opennest/core";

import { isDexieError, mapStorageError } from "../errors";
import { createDexieStorage } from "../index";

function driverError(name: string): Error {
  const error = new Error(name);
  error.name = name;

  return error;
}

describe("error mapping", () => {
  it("maps a quota failure to storage_error quota_exceeded", () => {
    const mapped = mapStorageError(driverError("QuotaExceededError"));

    expect(mapped).toBeInstanceOf(StorageError);
    expect(mapped).toMatchObject({ code: "quota_exceeded" });
  });

  it("maps a closed database to storage_error closed", () => {
    expect(mapStorageError(driverError("DatabaseClosedError"))).toMatchObject({
      code: "closed",
    });
  });

  it("maps the remaining Dexie failures to storage_error corrupt_data", () => {
    for (const name of [
      "ConstraintError",
      "DataError",
      "VersionError",
      "AbortError",
      "OpenFailedError",
      "ReadOnlyError",
      "TransactionInactiveError",
      "UnknownError",
    ]) {
      expect(mapStorageError(driverError(name))).toMatchObject({
        code: "corrupt_data",
      });
    }
  });

  it("keeps a DomainError as it is", () => {
    const original = new NotFoundError("Folder does not exist.");

    expect(mapStorageError(original)).toBe(original);
    expect(mapStorageError(original)).toBeInstanceOf(DomainError);
  });

  it("passes an unrelated error through untouched", () => {
    const original = new TypeError("boom");

    expect(mapStorageError(original)).toBe(original);
  });

  it("recognizes Dexie error names only", () => {
    expect(isDexieError(driverError("ConstraintError"))).toBe(true);
    expect(isDexieError(driverError("TypeError"))).toBe(false);
    expect(isDexieError(null)).toBe(false);
    expect(isDexieError({ name: 42 })).toBe(false);
  });

  it("surfaces a real quota failure as storage_error quota_exceeded", async () => {
    const originalAdd = globalThis.IDBObjectStore.prototype.add;
    const originalPut = globalThis.IDBObjectStore.prototype.put;
    const storage = createDexieStorage({
      databaseName: `opennest-quota-${Date.now()}`,
    });
    await storage.init();

    const fail = (): IDBRequest<IDBValidKey> => {
      throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    };

    globalThis.IDBObjectStore.prototype.add = fail;
    globalThis.IDBObjectStore.prototype.put = fail;

    try {
      await expect(
        storage.workspaces.create({
          name: "Penuh",
          at: "2026-11-12T00:00:00.000Z" as never,
        })
      ).rejects.toMatchObject({ code: "quota_exceeded" });
    } finally {
      globalThis.IDBObjectStore.prototype.add = originalAdd;
      globalThis.IDBObjectStore.prototype.put = originalPut;
      await storage.close();
    }
  });
});
