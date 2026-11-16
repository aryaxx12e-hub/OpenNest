import Dexie, { type Table } from "dexie";

import {
  PrivacyError,
  type AuditEntry,
  type CapabilityGrant,
  type PrivacyStore,
} from "@opennest/privacy";

const DEFAULT_DATABASE_NAME = "opennest-privacy";

interface MetaRow {
  key: string;
  value: string;
}

class PrivacyDatabase extends Dexie {
  declare grants: Table<CapabilityGrant, string>;
  declare audit: Table<AuditEntry, string>;
  declare meta: Table<MetaRow, string>;

  constructor(databaseName: string, options: PrivacyStoreOptions = {}) {
    super(databaseName, {
      ...(options.indexedDB === undefined ? {} : { indexedDB: options.indexedDB }),
      ...(options.IDBKeyRange === undefined ? {} : { IDBKeyRange: options.IDBKeyRange }),
    });

    this.version(1).stores({
      grants: "id, principalId, capability, status, expiresAt",
      audit: "id, sequence, at, event",
      meta: "key",
    });
  }
}

export interface PrivacyStoreOptions {
  databaseName?: string;
  indexedDB?: IDBFactory;
  IDBKeyRange?: typeof IDBKeyRange;
}

export function createDexiePrivacyStore(options: PrivacyStoreOptions = {}): PrivacyStore {
  const db = new PrivacyDatabase(options.databaseName ?? DEFAULT_DATABASE_NAME, options);
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
        throw storageError("The privacy store could not be opened.", error);
      }
    },
    async close() {
      db.close();
      initialized = false;
    },
    async reset() {
      try {
        await db.transaction("rw", db.grants, db.audit, db.meta, async () => {
          await db.grants.clear();
          await db.audit.clear();
          await db.meta.clear();
        });
      } catch (error) {
        throw storageError("The privacy store could not be reset.", error);
      }
    },
    grants: {
      async list() {
        return db.grants.toArray();
      },
      async get(id) {
        return (await db.grants.get(id)) ?? null;
      },
      async put(grant) {
        await db.grants.put(grant);
      },
      async delete(id) {
        await db.grants.delete(id);
      },
      async clear() {
        await db.grants.clear();
      },
    },
    audit: {
      async list() {
        return db.audit.toArray();
      },
      async append(entry) {
        await db.audit.add(entry);
      },
      async clear() {
        await db.audit.clear();
      },
    },
  };
}

function storageError(message: string, cause: unknown): PrivacyError {
  return new PrivacyError("storage_failed", message, { cause });
}
