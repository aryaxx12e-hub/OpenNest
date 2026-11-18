import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readStorageStatus, requestPersistentStorage } from "../storage-status";

const original = Object.getOwnPropertyDescriptor(window.navigator, "storage");

function setStorage(storage: Partial<StorageManager> | undefined) {
  Object.defineProperty(window.navigator, "storage", {
    configurable: true,
    value: storage,
  });
}

beforeEach(() => {
  setStorage(undefined);
});

afterEach(() => {
  if (original === undefined) {
    Reflect.deleteProperty(window.navigator, "storage");
  } else {
    Object.defineProperty(window.navigator, "storage", original);
  }
});

describe("readStorageStatus", () => {
  it("reports unsupported when navigator.storage is unavailable", async () => {
    await expect(readStorageStatus()).resolves.toEqual({
      supported: false,
      usage: null,
      quota: null,
      persisted: null,
    });
  });

  it("returns valid estimate and persisted values", async () => {
    setStorage({
      estimate: async () => ({ usage: 1536, quota: 2 * 1024 * 1024 }),
      persisted: async () => true,
    });

    await expect(readStorageStatus()).resolves.toEqual({
      supported: true,
      usage: 1536,
      quota: 2 * 1024 * 1024,
      persisted: true,
    });
  });

  it("leaves usage and quota unknown when estimate rejects", async () => {
    setStorage({
      estimate: async () => Promise.reject(new Error("estimate failed")),
      persisted: async () => true,
    });

    await expect(readStorageStatus()).resolves.toEqual({
      supported: true,
      usage: null,
      quota: null,
      persisted: true,
    });
  });

  it("leaves persistence unknown when persisted rejects", async () => {
    setStorage({
      estimate: async () => ({ usage: 10, quota: 100 }),
      persisted: async () => Promise.reject(new Error("persisted failed")),
    });

    await expect(readStorageStatus()).resolves.toEqual({
      supported: true,
      usage: 10,
      quota: 100,
      persisted: null,
    });
  });
});

describe("requestPersistentStorage", () => {
  it("returns granted when the browser grants persistence", async () => {
    setStorage({ persist: async () => true });

    await expect(requestPersistentStorage()).resolves.toBe("granted");
  });

  it("returns denied when the browser denies persistence", async () => {
    setStorage({ persist: async () => false });

    await expect(requestPersistentStorage()).resolves.toBe("denied");
  });

  it("returns unsupported when persist is unavailable", async () => {
    setStorage({});

    await expect(requestPersistentStorage()).resolves.toBe("unsupported");
  });
});
