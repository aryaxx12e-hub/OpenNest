import Dexie, { type Table } from "dexie";

import {
  parseVaultRecord,
  type CredentialVaultStore,
  type VaultRecordV1,
} from "@opennest/credential-vault";

import { CredentialRuntimeError } from "./errors";

const DEFAULT_DATABASE_NAME = "opennest-credentials";
const DEFAULT_VAULT_ROW_ID = "default";

interface VaultRow {
  id: string;
  record: VaultRecordV1;
}

class CredentialsDatabase extends Dexie {
  declare vaults: Table<VaultRow, string>;

  constructor(databaseName: string, options: DexieCredentialVaultStoreOptions = {}) {
    super(databaseName, {
      ...(options.indexedDB === undefined ? {} : { indexedDB: options.indexedDB }),
      ...(options.IDBKeyRange === undefined ? {} : { IDBKeyRange: options.IDBKeyRange }),
    });

    this.version(1).stores({
      vaults: "id",
    });
  }
}

export interface DexieCredentialVaultStoreOptions {
  databaseName?: string;
  indexedDB?: IDBFactory;
  IDBKeyRange?: typeof IDBKeyRange;
}

export interface DexieCredentialVaultStore extends CredentialVaultStore {
  init(): Promise<void>;
  close(): Promise<void>;
}

export function createDexieCredentialVaultStore(
  options: DexieCredentialVaultStoreOptions = {}
): DexieCredentialVaultStore {
  const db = new CredentialsDatabase(
    options.databaseName ?? DEFAULT_DATABASE_NAME,
    options
  );
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
        throw new CredentialRuntimeError(
          "storage_failed",
          "The credential vault store could not be opened.",
          { cause: error }
        );
      }
    },
    async close() {
      db.close();
      initialized = false;
    },
    async get() {
      const row = await db.vaults.get(DEFAULT_VAULT_ROW_ID);
      return row === undefined ? null : parseVaultRecord(row.record);
    },
    async put(record) {
      await db.vaults.put({
        id: DEFAULT_VAULT_ROW_ID,
        record: parseVaultRecord(record),
      });
    },
    async delete() {
      await db.vaults.delete(DEFAULT_VAULT_ROW_ID);
    },
  };
}
