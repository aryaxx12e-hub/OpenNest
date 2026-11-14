import type { StorageAdapter } from "@opennest/core";
import { createDexieStorage } from "@opennest/storage-dexie";

const DEFAULT_DATABASE_NAME = "opennest";

let pending: Promise<StorageAdapter> | null = null;

export interface OpenBrowserStorageOptions {
  databaseName?: string;
  createStorage?: (databaseName: string) => StorageAdapter;
}

export function openBrowserStorage(
  options: OpenBrowserStorageOptions = {}
): Promise<StorageAdapter> {
  if (pending !== null) {
    return pending;
  }

  const databaseName = options.databaseName ?? DEFAULT_DATABASE_NAME;
  const createStorage =
    options.createStorage ??
    ((name: string) => createDexieStorage({ databaseName: name }));

  const storage = createStorage(databaseName);

  pending = storage
    .init()
    .then(() => storage)
    .catch((error: unknown) => {
      pending = null;
      throw error;
    });

  return pending;
}

export function resetBrowserStorageConnection(): void {
  pending = null;
}
