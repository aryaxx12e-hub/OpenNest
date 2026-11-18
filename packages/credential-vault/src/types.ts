import type { KdfParameters, WrappedKey } from "@opennest/crypto";

export { CREDENTIAL_VAULT_KEK_DOMAIN } from "@opennest/crypto";

export const MIN_VAULT_PASSPHRASE_LENGTH = 12;
export const MAX_VAULT_ENTRIES = 50;
export const MAX_SECRET_BYTES = 8_192;
export const MAX_VAULT_UNLOCK_ATTEMPTS = 5;
export const VAULT_UNLOCK_RETRY_MS = 30_000;
export const DEFAULT_VAULT_AUTO_LOCK_MS = 5 * 60 * 1000;

export interface VaultEntryRecord {
  readonly id: string;
  readonly providerId: string;
  readonly accountLabel: string;
  readonly version: 1;
  readonly kid: string;
  readonly wrappedCek: WrappedKey;
  readonly iv: string;
  readonly ciphertext: string;
  readonly tag: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface VaultRecordV1 {
  version: 1;
  vaultId: string;
  activeKid: string;
  kdf: KdfParameters;
  wrappedDek: WrappedKey;
  entries: VaultEntryRecord[];
  failedAttempts: number;
  retryAfter: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface VaultEntryMetadata {
  readonly id: string;
  readonly providerId: string;
  readonly accountLabel: string;
  readonly version: 1;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface CredentialVaultStore {
  get(): Promise<VaultRecordV1 | null>;
  put(record: VaultRecordV1): Promise<void>;
  delete(): Promise<void>;
}

export interface CredentialVaultSession {
  readonly vaultId: string;
  readonly unlockedAt: number;
  readonly expiresAt: number;
  readonly isUnlocked: (at: number) => boolean;
  readonly touch: (at: number) => void;
  readonly lock: () => void;
}

export interface CredentialVault {
  get(): Promise<VaultRecordV1 | null>;
  hasVault(): Promise<boolean>;
  setup(
    passphrase: string,
    options?: { autoLockMs?: number }
  ): Promise<CredentialVaultSession>;
  unlock(
    passphrase: string,
    options?: { autoLockMs?: number }
  ): Promise<CredentialVaultSession>;
  changePassphrase(
    session: CredentialVaultSession,
    currentPassphrase: string,
    nextPassphrase: string
  ): Promise<void>;
  delete(): Promise<void>;
  list(session: CredentialVaultSession): Promise<readonly VaultEntryMetadata[]>;
  create(
    session: CredentialVaultSession,
    input: { providerId: string; accountLabel: string; secret: string }
  ): Promise<VaultEntryMetadata>;
  update(
    session: CredentialVaultSession,
    entryId: string,
    input: { accountLabel?: string; secret?: string }
  ): Promise<VaultEntryMetadata>;
  remove(session: CredentialVaultSession, entryId: string): Promise<void>;
  withSecret<T>(
    session: CredentialVaultSession,
    entryId: string,
    providerId: string,
    operation: (secret: string) => Promise<T>
  ): Promise<T>;
  rotate(session: CredentialVaultSession): Promise<void>;
}

export interface CreateCredentialVaultOptions {
  store: CredentialVaultStore;
  now?: () => number;
}
