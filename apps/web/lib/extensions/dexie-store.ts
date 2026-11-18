import Dexie, { type Table } from "dexie";

import {
  assertStorageQuota,
  cloneStoredExtension,
  ExtensionError,
  storageUsage,
  type ExtensionStorageEntry,
  type ExtensionStore,
  type StoredExtension,
} from "@opennest/extensions";

const DEFAULT_DATABASE_NAME = "opennest-extensions";
const SAFE_MODE_KEY = "safe-mode";

interface ExtensionStorageRow {
  extensionId: string;
  key: string;
  value: string;
}

interface MetaRow {
  key: string;
  value: boolean;
}

class ExtensionsDatabase extends Dexie {
  declare extensions: Table<StoredExtension, string>;
  declare storage: Table<ExtensionStorageRow, [string, string]>;
  declare meta: Table<MetaRow, string>;

  constructor(databaseName: string, options: DexieExtensionStoreOptions = {}) {
    super(databaseName, {
      ...(options.indexedDB === undefined ? {} : { indexedDB: options.indexedDB }),
      ...(options.IDBKeyRange === undefined ? {} : { IDBKeyRange: options.IDBKeyRange }),
    });

    this.version(1).stores({
      extensions: "id, enabled, updatedAt",
      storage: "[extensionId+key], extensionId",
      meta: "key",
    });
  }
}

export interface DexieExtensionStoreOptions {
  databaseName?: string;
  indexedDB?: IDBFactory;
  IDBKeyRange?: typeof IDBKeyRange;
}

export function createDexieExtensionStore(
  options: DexieExtensionStoreOptions = {}
): ExtensionStore {
  const db = new ExtensionsDatabase(
    options.databaseName ?? DEFAULT_DATABASE_NAME,
    options
  );
  let initialized = false;

  async function rows(extensionId: string): Promise<ExtensionStorageEntry[]> {
    return db.storage.where("extensionId").equals(extensionId).toArray();
  }

  return {
    async init() {
      if (initialized) {
        return;
      }

      try {
        await db.open();
        initialized = true;
      } catch (error) {
        throw storageFailure("The extension store could not be opened.", error);
      }
    },
    async close() {
      db.close();
      initialized = false;
    },
    async reset() {
      try {
        await db.transaction("rw", db.extensions, db.storage, db.meta, async () => {
          await db.extensions.clear();
          await db.storage.clear();
          await db.meta.clear();
        });
      } catch (error) {
        throw storageFailure("The extension store could not be reset.", error);
      }
    },
    async uninstall(extensionId) {
      try {
        await db.transaction("rw", db.extensions, db.storage, async () => {
          await db.extensions.delete(extensionId);
          await db.storage.where("extensionId").equals(extensionId).delete();
        });
      } catch (error) {
        throw storageFailure("The extension could not be uninstalled.", error);
      }
    },
    async getSafeMode() {
      try {
        const row = await db.meta.get(SAFE_MODE_KEY);
        return row?.value === true;
      } catch (error) {
        throw storageFailure("Safe mode could not be read.", error);
      }
    },
    async setSafeMode(enabled) {
      try {
        await db.meta.put({ key: SAFE_MODE_KEY, value: enabled });
      } catch (error) {
        throw storageFailure("Safe mode could not be saved.", error);
      }
    },
    extensions: {
      async list() {
        try {
          return (await db.extensions.toArray())
            .map(cloneStoredExtension)
            .sort((left, right) => left.id.localeCompare(right.id));
        } catch (error) {
          throw storageFailure("Extensions could not be listed.", error);
        }
      },
      async get(id) {
        try {
          const record = await db.extensions.get(id);
          return record === undefined ? null : cloneStoredExtension(record);
        } catch (error) {
          throw storageFailure("The extension could not be read.", error);
        }
      },
      async put(record) {
        try {
          await db.extensions.put(cloneStoredExtension(record));
        } catch (error) {
          throw storageFailure("The extension could not be saved.", error);
        }
      },
      async delete(id) {
        try {
          await db.extensions.delete(id);
        } catch (error) {
          throw storageFailure("The extension could not be deleted.", error);
        }
      },
      async clear() {
        try {
          await db.extensions.clear();
        } catch (error) {
          throw storageFailure("Extensions could not be cleared.", error);
        }
      },
    },
    storage: {
      async get(extensionId, key) {
        try {
          const row = await db.storage.get([extensionId, key]);
          return row?.value ?? null;
        } catch (error) {
          throw storageFailure("Extension storage could not be read.", error);
        }
      },
      async set(extensionId, key, value) {
        try {
          const current = await rows(extensionId);
          assertStorageQuota(current, key, value);
          await db.storage.put({ extensionId, key, value });
        } catch (error) {
          throw storageFailure("Extension storage could not be saved.", error);
        }
      },
      async delete(extensionId, key) {
        try {
          await db.storage.delete([extensionId, key]);
        } catch (error) {
          throw storageFailure("Extension storage could not be deleted.", error);
        }
      },
      async keys(extensionId) {
        try {
          return (await rows(extensionId)).map((row) => row.key).sort();
        } catch (error) {
          throw storageFailure("Extension storage keys could not be read.", error);
        }
      },
      async clear(extensionId) {
        try {
          await db.storage.where("extensionId").equals(extensionId).delete();
        } catch (error) {
          throw storageFailure("Extension storage could not be cleared.", error);
        }
      },
      async usage(extensionId) {
        try {
          return storageUsage(await rows(extensionId));
        } catch (error) {
          throw storageFailure("Extension storage usage could not be read.", error);
        }
      },
    },
  };
}

function storageFailure(message: string, cause: unknown): ExtensionError {
  if (cause instanceof ExtensionError) {
    return cause;
  }

  return new ExtensionError("storage_failed", message, { cause });
}
