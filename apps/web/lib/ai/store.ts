import Dexie, { type Table } from "dexie";

import {
  AiError,
  createMemoryAiProviderStore,
  type AiProviderConfig,
  type AiProviderStore,
} from "@opennest/ai";

const DEFAULT_DATABASE_NAME = "opennest-ai";
const ENABLED_KEY = "enabled";

interface MetaRow {
  key: string;
  value: boolean;
}

class AiDatabase extends Dexie {
  declare providers: Table<AiProviderConfig, string>;
  declare meta: Table<MetaRow, string>;

  constructor(databaseName: string, options: DexieAiStoreOptions = {}) {
    super(databaseName, {
      ...(options.indexedDB === undefined ? {} : { indexedDB: options.indexedDB }),
      ...(options.IDBKeyRange === undefined ? {} : { IDBKeyRange: options.IDBKeyRange }),
    });

    this.version(1).stores({
      providers: "id, kind, updatedAt",
      meta: "key",
    });
  }
}

export interface AiStore {
  init(): Promise<void>;
  close(): Promise<void>;
  reset(): Promise<void>;
  readonly providers: AiProviderStore;
  getEnabled(): Promise<boolean>;
  setEnabled(enabled: boolean): Promise<void>;
}

export interface DexieAiStoreOptions {
  databaseName?: string;
  indexedDB?: IDBFactory;
  IDBKeyRange?: typeof IDBKeyRange;
}

export function createDexieAiStore(options: DexieAiStoreOptions = {}): AiStore {
  const db = new AiDatabase(options.databaseName ?? DEFAULT_DATABASE_NAME, options);
  let initialized = false;

  return {
    async init() {
      if (initialized) {
        return;
      }

      try {
        await db.open();
        initialized = true;
      } catch (error) {
        throw storageError("The AI store could not be opened.", error);
      }
    },
    async close() {
      db.close();
      initialized = false;
    },
    async reset() {
      try {
        await db.transaction("rw", db.providers, db.meta, async () => {
          await db.providers.clear();
          await db.meta.clear();
        });
      } catch (error) {
        throw storageError("The AI store could not be reset.", error);
      }
    },
    providers: {
      async list() {
        return (await db.providers.toArray()).map(cloneProvider);
      },
      async get(id) {
        const provider = await db.providers.get(id);
        return provider === undefined ? null : cloneProvider(provider);
      },
      async put(config) {
        try {
          await db.providers.put(cloneProvider(config));
        } catch (error) {
          throw storageError("The AI provider could not be saved.", error);
        }
      },
      async delete(id) {
        try {
          await db.providers.delete(id);
        } catch (error) {
          throw storageError("The AI provider could not be deleted.", error);
        }
      },
      async clear() {
        try {
          await db.providers.clear();
        } catch (error) {
          throw storageError("The AI providers could not be cleared.", error);
        }
      },
    },
    async getEnabled() {
      try {
        const row = await db.meta.get(ENABLED_KEY);
        return row?.value === true;
      } catch (error) {
        throw storageError("The AI setting could not be read.", error);
      }
    },
    async setEnabled(enabled) {
      try {
        await db.meta.put({ key: ENABLED_KEY, value: enabled });
      } catch (error) {
        throw storageError("The AI setting could not be saved.", error);
      }
    },
  };
}

export function createMemoryAiStore(): AiStore {
  const providers = createMemoryAiProviderStore();
  let enabled = false;

  return {
    async init() {
      return undefined;
    },
    async close() {
      return undefined;
    },
    async reset() {
      await providers.clear();
      enabled = false;
    },
    providers,
    async getEnabled() {
      return enabled;
    },
    async setEnabled(next) {
      enabled = next;
    },
  };
}

function cloneProvider(config: AiProviderConfig): AiProviderConfig {
  return {
    ...config,
    models: [...config.models],
    capabilities: [...config.capabilities],
  };
}

function storageError(message: string, cause: unknown): AiError {
  return new AiError("storage_failed", message, { cause });
}
