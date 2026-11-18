import {
  assertStorageKey,
  assertStorageQuota,
  cloneStoredExtension,
  storageUsage,
  type ExtensionStorageEntry,
  type ExtensionStore,
  type StoredExtension,
} from "./store";

export function createMemoryExtensionStore(): ExtensionStore {
  const extensions = new Map<string, StoredExtension>();
  const storage = new Map<string, Map<string, string>>();
  let safeMode = false;

  function entries(extensionId: string): ExtensionStorageEntry[] {
    return Array.from(storage.get(extensionId)?.entries() ?? [], ([key, value]) => ({
      key,
      value,
    }));
  }

  function bucket(extensionId: string): Map<string, string> {
    let current = storage.get(extensionId);

    if (current === undefined) {
      current = new Map<string, string>();
      storage.set(extensionId, current);
    }

    return current;
  }

  return {
    async init() {
      return undefined;
    },
    async close() {
      return undefined;
    },
    async reset() {
      extensions.clear();
      storage.clear();
      safeMode = false;
    },
    async uninstall(extensionId) {
      extensions.delete(extensionId);
      storage.delete(extensionId);
    },
    async getSafeMode() {
      return safeMode;
    },
    async setSafeMode(enabled) {
      safeMode = enabled;
    },
    extensions: {
      async list() {
        return Array.from(extensions.values(), cloneStoredExtension).sort((left, right) =>
          left.id.localeCompare(right.id)
        );
      },
      async get(id) {
        const record = extensions.get(id);
        return record === undefined ? null : cloneStoredExtension(record);
      },
      async put(record) {
        extensions.set(record.id, cloneStoredExtension(record));
      },
      async delete(id) {
        extensions.delete(id);
      },
      async clear() {
        extensions.clear();
      },
    },
    storage: {
      async get(extensionId, key) {
        assertStorageKey(key);
        return storage.get(extensionId)?.get(key) ?? null;
      },
      async set(extensionId, key, value) {
        const current = entries(extensionId);
        assertStorageQuota(current, key, value);
        bucket(extensionId).set(key, value);
      },
      async delete(extensionId, key) {
        assertStorageKey(key);
        storage.get(extensionId)?.delete(key);
      },
      async keys(extensionId) {
        return Array.from(storage.get(extensionId)?.keys() ?? []).sort();
      },
      async clear(extensionId) {
        storage.delete(extensionId);
      },
      async usage(extensionId) {
        return storageUsage(entries(extensionId));
      },
    },
  };
}
