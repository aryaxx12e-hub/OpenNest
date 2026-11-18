import { ExtensionError } from "./errors";
import type { ExtensionManifest } from "./manifest";

export const EXTENSION_MAX_STORAGE_BYTES = 1_024 * 1_024;
export const EXTENSION_MAX_STORAGE_KEYS = 256;
export const EXTENSION_MAX_STORAGE_VALUE_BYTES = 64 * 1_024;

const STORAGE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export interface StoredExtension {
  readonly id: string;
  readonly manifest: ExtensionManifest;
  readonly code: string;
  readonly integrity: string;
  readonly installedAt: number;
  readonly updatedAt: number;
  readonly enabled: boolean;
}

export interface ExtensionRecordStore {
  list(): Promise<StoredExtension[]>;
  get(id: string): Promise<StoredExtension | null>;
  put(record: StoredExtension): Promise<void>;
  delete(id: string): Promise<void>;
  clear(): Promise<void>;
}

export interface ExtensionStorageEntry {
  readonly key: string;
  readonly value: string;
}

export interface ExtensionStorageStore {
  get(extensionId: string, key: string): Promise<string | null>;
  set(extensionId: string, key: string, value: string): Promise<void>;
  delete(extensionId: string, key: string): Promise<void>;
  keys(extensionId: string): Promise<string[]>;
  clear(extensionId: string): Promise<void>;
  usage(extensionId: string): Promise<number>;
}

export interface ExtensionStore {
  init(): Promise<void>;
  close(): Promise<void>;
  reset(): Promise<void>;
  uninstall(extensionId: string): Promise<void>;
  getSafeMode(): Promise<boolean>;
  setSafeMode(enabled: boolean): Promise<void>;
  readonly extensions: ExtensionRecordStore;
  readonly storage: ExtensionStorageStore;
}

export function storageByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function assertStorageKey(key: string): void {
  if (!STORAGE_KEY_PATTERN.test(key)) {
    throw new ExtensionError(
      "storage_key",
      "Storage keys must start with a letter or digit and use letters, digits, dots, underscores, or hyphens."
    );
  }
}

export function assertStorageValue(value: string): void {
  if (storageByteLength(value) > EXTENSION_MAX_STORAGE_VALUE_BYTES) {
    throw new ExtensionError(
      "storage_value_too_large",
      `Storage values must be at most ${EXTENSION_MAX_STORAGE_VALUE_BYTES} bytes.`
    );
  }
}

export function storageUsage(entries: readonly ExtensionStorageEntry[]): number {
  return entries.reduce(
    (total, entry) =>
      total + storageByteLength(entry.key) + storageByteLength(entry.value),
    0
  );
}

export function assertStorageQuota(
  entries: readonly ExtensionStorageEntry[],
  nextKey: string,
  nextValue: string
): void {
  assertStorageKey(nextKey);
  assertStorageValue(nextValue);

  const existing = entries.find((entry) => entry.key === nextKey);

  if (existing === undefined && entries.length >= EXTENSION_MAX_STORAGE_KEYS) {
    throw new ExtensionError(
      "storage_quota",
      `Extensions may store at most ${EXTENSION_MAX_STORAGE_KEYS} keys.`
    );
  }

  const currentBytes = storageUsage(entries);
  const existingBytes =
    existing === undefined
      ? 0
      : storageByteLength(existing.key) + storageByteLength(existing.value);
  const nextBytes =
    currentBytes -
    existingBytes +
    storageByteLength(nextKey) +
    storageByteLength(nextValue);

  if (nextBytes > EXTENSION_MAX_STORAGE_BYTES) {
    throw new ExtensionError(
      "storage_quota",
      `Extension storage must stay below ${EXTENSION_MAX_STORAGE_BYTES} bytes.`
    );
  }
}

export function cloneStoredExtension(record: StoredExtension): StoredExtension {
  return {
    ...record,
    manifest: {
      ...record.manifest,
      capabilities: [...record.manifest.capabilities],
      dataScopes: [...record.manifest.dataScopes],
      networkOrigins: [...record.manifest.networkOrigins],
    },
  };
}
