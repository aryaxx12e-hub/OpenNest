import { describe, expect, it } from "vitest";

import type { ExtensionManifest } from "../manifest";
import { createMemoryExtensionStore } from "../memory-store";
import {
  EXTENSION_MAX_STORAGE_BYTES,
  EXTENSION_MAX_STORAGE_KEYS,
  EXTENSION_MAX_STORAGE_VALUE_BYTES,
  type StoredExtension,
} from "../store";

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

describe("extension memory store", () => {
  it("stores, lists, updates, and deletes extensions", async () => {
    const store = createMemoryExtensionStore();
    await store.init();
    await store.extensions.put(record());

    expect(await store.extensions.get("com.example.demo")).toMatchObject({
      enabled: true,
    });
    expect((await store.extensions.list()).map((entry) => entry.id)).toEqual([
      "com.example.demo",
    ]);

    await store.extensions.put(record({ enabled: false, updatedAt: 2 }));
    expect(await store.extensions.get("com.example.demo")).toMatchObject({
      enabled: false,
      updatedAt: 2,
    });

    await store.extensions.delete("com.example.demo");
    expect(await store.extensions.get("com.example.demo")).toBeNull();
    await store.close();
  });

  it("isolates storage by extension and reports usage", async () => {
    const store = createMemoryExtensionStore();
    await store.storage.set("com.example.demo", "count", "1");
    await store.storage.set("com.example.other", "count", "9");
    await store.storage.set("com.example.demo", "alpha", "two");

    expect(await store.storage.get("com.example.demo", "count")).toBe("1");
    expect(await store.storage.get("com.example.other", "count")).toBe("9");
    expect(await store.storage.keys("com.example.demo")).toEqual(["alpha", "count"]);
    expect(await store.storage.usage("com.example.demo")).toBe(
      "count".length + 1 + "alpha".length + 3
    );

    await store.storage.delete("com.example.demo", "count");
    expect(await store.storage.get("com.example.demo", "count")).toBeNull();
    await store.storage.clear("com.example.demo");
    expect(await store.storage.keys("com.example.demo")).toEqual([]);
    expect(await store.storage.keys("com.example.other")).toEqual(["count"]);
  });

  it("enforces storage key, value, and total quotas", async () => {
    const store = createMemoryExtensionStore();

    await expect(
      store.storage.set("com.example.demo", "huge", "x".repeat(64 * 1_024 + 1))
    ).rejects.toMatchObject({ code: "storage_value_too_large" });
    await expect(
      store.storage.set("com.example.demo", "bad key", "x")
    ).rejects.toMatchObject({ code: "storage_key" });
    await expect(
      store.storage.set("com.example.demo", "x".repeat(129), "x")
    ).rejects.toMatchObject({ code: "storage_key" });

    expect(EXTENSION_MAX_STORAGE_VALUE_BYTES).toBe(64 * 1_024);
    expect(EXTENSION_MAX_STORAGE_BYTES).toBe(1_024 * 1_024);
    expect(EXTENSION_MAX_STORAGE_KEYS).toBe(256);

    for (let index = 0; index < EXTENSION_MAX_STORAGE_KEYS; index += 1) {
      await store.storage.set("com.example.demo", `key-${index}`, "x");
    }

    await expect(
      store.storage.set("com.example.demo", "one-too-many", "x")
    ).rejects.toMatchObject({ code: "storage_quota" });
  });

  it("uninstalls an extension and all of its storage", async () => {
    const store = createMemoryExtensionStore();
    await store.extensions.put(record());
    await store.storage.set("com.example.demo", "count", "1");
    await store.storage.set("com.example.other", "count", "9");

    await store.uninstall("com.example.demo");

    expect(await store.extensions.get("com.example.demo")).toBeNull();
    expect(await store.storage.keys("com.example.demo")).toEqual([]);
    expect(await store.storage.get("com.example.other", "count")).toBe("9");
  });

  it("resets all state and persists safe mode within the store", async () => {
    const store = createMemoryExtensionStore();
    await store.extensions.put(record());
    await store.storage.set("com.example.demo", "count", "1");
    expect(await store.getSafeMode()).toBe(false);

    await store.setSafeMode(true);
    expect(await store.getSafeMode()).toBe(true);

    await store.reset();

    expect(await store.extensions.list()).toEqual([]);
    expect(await store.storage.keys("com.example.demo")).toEqual([]);
    expect(await store.getSafeMode()).toBe(false);
  });
});
