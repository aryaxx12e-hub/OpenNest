import {
  createIndexedDbKeyringStore,
  createMemoryKeyringStore,
  type KeyringStore,
} from "@opennest/crypto";

export function openBrowserKeyringStore(): Promise<KeyringStore> {
  if (typeof indexedDB === "undefined") {
    return Promise.resolve(createMemoryKeyringStore());
  }

  return Promise.resolve(createIndexedDbKeyringStore());
}
