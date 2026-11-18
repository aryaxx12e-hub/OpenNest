import {
  CREDENTIAL_VAULT_KEK_DOMAIN,
  GCM_NONCE_BYTES,
  GCM_TAG_BYTES,
  KEK_BYTES,
  parseKdfParameters,
  parseWrappedKey,
  type KdfParameters,
  type WrappedKey,
} from "@opennest/crypto";

import { CredentialVaultError } from "./errors";
import {
  MAX_SECRET_BYTES,
  MAX_VAULT_ENTRIES,
  MAX_VAULT_UNLOCK_ATTEMPTS,
  type VaultEntryRecord,
  type VaultRecordV1,
} from "./types";

const RECORD_KEYS = [
  "version",
  "vaultId",
  "activeKid",
  "kdf",
  "wrappedDek",
  "entries",
  "failedAttempts",
  "retryAfter",
  "createdAt",
  "updatedAt",
] as const;

const KDF_KEYS = ["name", "hash", "iterations", "salt", "domain"] as const;
const WRAPPED_KEY_KEYS = ["iv", "ciphertext", "tag"] as const;
const ENTRY_KEYS = [
  "id",
  "providerId",
  "accountLabel",
  "version",
  "kid",
  "wrappedCek",
  "iv",
  "ciphertext",
  "tag",
  "createdAt",
  "updatedAt",
] as const;

export function parseVaultRecord(value: unknown): VaultRecordV1 {
  try {
    const record = requireObject(value, "Vault record");
    requireExactKeys(record, RECORD_KEYS, "Vault record");

    if (record.version !== 1) {
      throw corrupt("Unsupported vault version");
    }

    const vaultId = requireString(record.vaultId, "vaultId");
    const activeKid = requireString(record.activeKid, "activeKid");
    const kdf = parseStoredKdf(record.kdf);
    const wrappedDek = parseStoredWrappedKey(record.wrappedDek, "wrappedDek");

    if (!Array.isArray(record.entries)) {
      throw corrupt("Vault entries must be an array");
    }

    if (record.entries.length > MAX_VAULT_ENTRIES) {
      throw corrupt("Vault has too many entries");
    }

    const entries = record.entries.map((entry) => parseEntryRecord(entry));
    const ids = new Set(entries.map((entry) => entry.id));

    if (ids.size !== entries.length) {
      throw corrupt("Vault entry IDs must be unique");
    }

    for (const entry of entries) {
      if (entry.kid !== activeKid) {
        throw corrupt("Vault entry key ID does not match the active key");
      }
    }

    const failedAttempts = requireNonNegativeInteger(
      record.failedAttempts,
      "failedAttempts"
    );
    const retryAfter = parseOptionalTimestamp(record.retryAfter, "retryAfter");

    if (failedAttempts > MAX_VAULT_UNLOCK_ATTEMPTS) {
      throw corrupt("Too many failed unlock attempts");
    }

    if (failedAttempts >= MAX_VAULT_UNLOCK_ATTEMPTS && retryAfter === null) {
      throw corrupt("A rate-limited vault must have a retry time");
    }

    if (failedAttempts < MAX_VAULT_UNLOCK_ATTEMPTS && retryAfter !== null) {
      throw corrupt("A vault retry time requires five failed attempts");
    }

    return {
      version: 1,
      vaultId,
      activeKid,
      kdf,
      wrappedDek,
      entries,
      failedAttempts,
      retryAfter,
      createdAt: requireTimestamp(record.createdAt, "createdAt"),
      updatedAt: requireTimestamp(record.updatedAt, "updatedAt"),
    };
  } catch (error) {
    if (error instanceof CredentialVaultError && error.code === "vault_corrupt") {
      throw error;
    }

    throw corrupt("Vault record is corrupt", error);
  }
}

export function assertProviderId(value: string): void {
  if (!isValidProviderId(value)) {
    throw new CredentialVaultError(
      "invalid_provider_id",
      "The provider ID is not valid."
    );
  }
}

export function isValidProviderId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 300 &&
    value.trim() === value &&
    !value.includes("*") &&
    !value.includes("..") &&
    !/[\u0000-\u001f\u007f\s/\\#?]/.test(value)
  );
}

function parseEntryRecord(value: unknown): VaultEntryRecord {
  const entry = requireObject(value, "Vault entry");
  requireExactKeys(entry, ENTRY_KEYS, "Vault entry");

  if (entry.version !== 1) {
    throw corrupt("Unsupported vault entry version");
  }

  const id = requireString(entry.id, "entry.id");
  const providerId = requireString(entry.providerId, "entry.providerId");
  const accountLabel = requireString(entry.accountLabel, "entry.accountLabel");
  const kid = requireString(entry.kid, "entry.kid");
  const wrappedCek = parseStoredWrappedKey(entry.wrappedCek, "entry.wrappedCek");

  if (!isValidProviderId(providerId)) {
    throw corrupt("Vault entry provider ID is invalid");
  }

  if (accountLabel.length > 120) {
    throw corrupt("Vault entry account label is too long");
  }

  const iv = requireString(entry.iv, "entry.iv");
  const ciphertext = requireString(entry.ciphertext, "entry.ciphertext");
  const tag = requireString(entry.tag, "entry.tag");
  const sealed = parseWrappedKey({ iv, ciphertext, tag });

  if (sealed.iv.length !== GCM_NONCE_BYTES || sealed.tag.length !== GCM_TAG_BYTES) {
    throw corrupt("Vault entry nonce or tag has the wrong length");
  }

  if (sealed.ciphertext.length > MAX_SECRET_BYTES) {
    throw corrupt("Vault entry secret is too large");
  }

  return {
    id,
    providerId,
    accountLabel,
    version: 1,
    kid,
    wrappedCek,
    iv,
    ciphertext,
    tag,
    createdAt: requireTimestamp(entry.createdAt, "entry.createdAt"),
    updatedAt: requireTimestamp(entry.updatedAt, "entry.updatedAt"),
  };
}

function parseStoredKdf(value: unknown): KdfParameters {
  const kdf = requireObject(value, "kdf");
  requireExactKeys(kdf, KDF_KEYS, "kdf");
  const parsed = parseKdfParameters(kdf);

  if (parsed.domain !== CREDENTIAL_VAULT_KEK_DOMAIN) {
    throw corrupt("Vault KDF domain does not match");
  }

  return parsed;
}

function parseStoredWrappedKey(value: unknown, label: string): WrappedKey {
  const wrapped = requireObject(value, label);
  requireExactKeys(wrapped, WRAPPED_KEY_KEYS, label);
  parseWrappedKey(wrapped, KEK_BYTES);

  return {
    iv: requireString(wrapped.iv, `${label}.iv`),
    ciphertext: requireString(wrapped.ciphertext, `${label}.ciphertext`),
    tag: requireString(wrapped.tag, `${label}.tag`),
  };
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw corrupt(`${label} must be an object`);
  }

  return value as Record<string, unknown>;
}

function requireExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string
): void {
  const actual = Object.keys(value);
  const expected = new Set(keys);

  if (actual.length !== keys.length || actual.some((key) => !expected.has(key))) {
    throw corrupt(`${label} has unknown or missing fields`);
  }
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw corrupt(`${label} must be a non-empty string`);
  }

  return value;
}

function requireTimestamp(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw corrupt(`${label} must be a timestamp`);
  }

  return value;
}

function parseOptionalTimestamp(value: unknown, label: string): number | null {
  return value === null ? null : requireTimestamp(value, label);
}

function requireNonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw corrupt(`${label} must be a non-negative integer`);
  }

  return value;
}

function corrupt(message: string, cause?: unknown): CredentialVaultError {
  return new CredentialVaultError("vault_corrupt", message, { cause });
}
