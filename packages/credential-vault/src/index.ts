export { CredentialVaultError } from "./errors";
export type { CredentialVaultErrorCode } from "./errors";
export { createMemoryCredentialVaultStore } from "./memory-store";
export { assertProviderId, isValidProviderId, parseVaultRecord } from "./record";
export { createCredentialVault } from "./vault";
export {
  CREDENTIAL_VAULT_KEK_DOMAIN,
  DEFAULT_VAULT_AUTO_LOCK_MS,
  MAX_SECRET_BYTES,
  MAX_VAULT_ENTRIES,
  MAX_VAULT_UNLOCK_ATTEMPTS,
  MIN_VAULT_PASSPHRASE_LENGTH,
  VAULT_UNLOCK_RETRY_MS,
} from "./types";
export type {
  CreateCredentialVaultOptions,
  CredentialVault,
  CredentialVaultSession,
  CredentialVaultStore,
  VaultEntryMetadata,
  VaultEntryRecord,
  VaultRecordV1,
} from "./types";
