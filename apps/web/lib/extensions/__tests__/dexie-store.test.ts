import "fake-indexeddb/auto";

import { describe, expect, it } from "vitest";

import type { ExtensionManifest } from "@opennest/extensions";
import { EXTENSION_MAX_STORAGE_KEYS, type StoredExtension } from "@opennest/extensions";

import { createDexieExtensionStore } from "../dexie-store";

const MANIFEST: ExtensionManifest = {
  id: "com.example.demo",
  name: "Demo extension",
  version: "1.0.0",
  publisher: "Example",
  description: "A small test extension.",
  tier: 1,
  entry: "main.js",
  capabilities: ["workspace.read.metadata"],
  dataScopes: ["notes"],
  networkOrigins: [],
  minHostVersion: "0.1.0",
};

function record(overrides: Partial<StoredExtension> = {}): StoredExtension {
  return {
    id: "com.example.demo",
    manifest: MANIFEST,
    code: "opennest.register(() => ({}));",
    integrity: `sha256:${"a".repeat(64)}`,
    installedAt: 1,
    updatedAt: 1,
    enabled: true,
    ...overrides,
  };
}

function uniqueDatabaseName(): string {
  return `opennest-extensions-test-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

describe("extension Dexie store", () => {
  it("persists extensions, storage, and safe mode across reopen", async () => {
    const databaseName = uniqueDatabaseName();
    const store = createDexieExtensionStore({ databaseName });
    await store.init();
    await store.extensions.put(record());
    await store.storage.set("com.example.demo", "count", "1");
    await store.setSafeMode(true);
    await store.close();

    const reopened = createDexieExtensionStore({ databaseName });
    await reopened.init();

    expect(await reopened.extensions.get("com.example.demo")).toMatchObject({
      enabled: true,
      code: "opennest.register(() => ({}));",
    });
    expect(await reopened.storage.get("com.example.demo", "count")).toBe("1");
    expect(await reopened.getSafeMode()).toBe(true);

    await reopened.close();
  });

  it("isolates storage and reports usage", async () => {
    const store = createDexieExtensionStore({ databaseName: uniqueDatabaseName() });
    await store.init();
    await store.storage.set("com.example.demo", "count", "1");
    await store.storage.set("com.example.demo", "alpha", "two");
    await store.storage.set("com.example.other", "count", "9");

    expect(await store.storage.keys("com.example.demo")).toEqual(["alpha", "count"]);
    expect(await store.storage.usage("com.example.demo")).toBe(14);
    expect(await store.storage.get("com.example.other", "count")).toBe("9");

    await store.close();
  });

  it("enforces storage quotas", async () => {
    const store = createDexieExtensionStore({ databaseName: uniqueDatabaseName() });
    await store.init();

    await expect(
      store.storage.set("com.example.demo", "huge", "x".repeat(64 * 1_024 + 1))
    ).rejects.toMatchObject({ code: "storage_value_too_large" });
    await expect(
      store.storage.set("com.example.demo", "bad key", "x")
    ).rejects.toMatchObject({ code: "storage_key" });

    for (let index = 0; index < EXTENSION_MAX_STORAGE_KEYS; index += 1) {
      await store.storage.set("com.example.demo", `key-${index}`, "x");
    }

    await expect(
      store.storage.set("com.example.demo", "one-too-many", "x")
    ).rejects.toMatchObject({ code: "storage_quota" });

    await store.close();
  });

  it("uninstalls an extension and its storage in one transaction", async () => {
    const store = createDexieExtensionStore({ databaseName: uniqueDatabaseName() });
    await store.init();
    await store.extensions.put(record());
    await store.storage.set("com.example.demo", "count", "1");
    await store.storage.set("com.example.other", "count", "9");

    await store.uninstall("com.example.demo");

    expect(await store.extensions.get("com.example.demo")).toBeNull();
    expect(await store.storage.keys("com.example.demo")).toEqual([]);
    expect(await store.storage.get("com.example.other", "count")).toBe("9");
    await store.close();
  });

  it("resets all tables and safe mode", async () => {
    const store = createDexieExtensionStore({ databaseName: uniqueDatabaseName() });
    await store.init();
    await store.extensions.put(record());
    await store.storage.set("com.example.demo", "count", "1");
    await store.setSafeMode(true);

    await store.reset();

    expect(await store.extensions.list()).toEqual([]);
    expect(await store.storage.keys("com.example.demo")).toEqual([]);
    expect(await store.getSafeMode()).toBe(false);
    await store.close();
  });
});
