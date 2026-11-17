import { CryptoError } from "./errors";
import type { KeyringRecordV1 } from "./keyring";
import type { KeyringStore } from "./keyring-store";

const DEFAULT_DATABASE = "opennest-crypto";
const OBJECT_STORE = "keyrings";

export interface IndexedDbKeyringStoreOptions {
  indexedDB?: IDBFactory;
  databaseName?: string;
}

export function createIndexedDbKeyringStore(
  options: IndexedDbKeyringStoreOptions = {}
): KeyringStore {
  const factory = options.indexedDB ?? globalThis.indexedDB;

  if (factory === undefined) {
    throw new CryptoError("keyring_store_failed", "IndexedDB is unavailable");
  }

  const databaseName = options.databaseName ?? DEFAULT_DATABASE;
  let databasePromise: Promise<IDBDatabase> | null = null;

  function openDatabase(): Promise<IDBDatabase> {
    if (databasePromise !== null) {
      return databasePromise;
    }

    databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(databaseName, 1);

      request.onupgradeneeded = () => {
        const database = request.result;

        if (!database.objectStoreNames.contains(OBJECT_STORE)) {
          database.createObjectStore(OBJECT_STORE, { keyPath: "workspaceId" });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(
          new CryptoError("keyring_store_failed", "Could not open the crypto keyring", {
            cause: request.error,
          })
        );
      request.onblocked = () =>
        reject(new CryptoError("keyring_store_failed", "The crypto keyring is blocked"));
    });

    void databasePromise.catch(() => {
      databasePromise = null;
    });

    return databasePromise;
  }

  return {
    async get(workspaceId) {
      const database = await openDatabase();
      const transaction = database.transaction(OBJECT_STORE, "readonly");
      const request = transaction.objectStore(OBJECT_STORE).get(workspaceId);
      const result = await requestResult<KeyringRecordV1 | undefined>(request);

      return result ?? null;
    },
    async put(record) {
      const database = await openDatabase();
      const transaction = database.transaction(OBJECT_STORE, "readwrite");
      transaction.objectStore(OBJECT_STORE).put(record);
      await transactionDone(transaction);
    },
    async delete(workspaceId) {
      const database = await openDatabase();
      const transaction = database.transaction(OBJECT_STORE, "readwrite");
      transaction.objectStore(OBJECT_STORE).delete(workspaceId);
      await transactionDone(transaction);
    },
    async clear() {
      const database = await openDatabase();
      const transaction = database.transaction(OBJECT_STORE, "readwrite");
      transaction.objectStore(OBJECT_STORE).clear();
      await transactionDone(transaction);
    },
    async close() {
      if (databasePromise === null) {
        return;
      }

      const database = await databasePromise;
      database.close();
      databasePromise = null;
    },
  };
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(
        new CryptoError("keyring_store_failed", "Keyring request failed", {
          cause: request.error,
        })
      );
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(
        new CryptoError("keyring_store_failed", "Keyring transaction failed", {
          cause: transaction.error,
        })
      );
    transaction.onabort = () =>
      reject(
        new CryptoError("keyring_store_failed", "Keyring transaction was aborted", {
          cause: transaction.error,
        })
      );
  });
}
