export {
  AES_GCM_ALGORITHM,
  AES_KEY_BYTES,
  GCM_NONCE_BYTES,
  GCM_TAG_BYTES,
  decryptAesGcm,
  encryptAesGcm,
  importAesGcmKey,
  isWrappedKey,
  parseWrappedKey,
  unwrapKeyBytes,
  wrapKeyBytes,
} from "./aes";
export type { ParsedWrappedKey, SealedBytes, WrappedKey } from "./aes";
export { base64UrlDecode, base64UrlEncode } from "./base64url";
export { bytesToHex, concatBytes, copyBytes, decodeUtf8, utf8 } from "./bytes";
export { canonicalJson } from "./canonical-json";
export {
  buildEnvelopeAad,
  openBytes,
  openText,
  parseBinaryEnvelope,
  parseTextEnvelope,
  sealBytes,
  sealText,
} from "./envelope";
export type {
  EnvelopeContext,
  OpenBytesInput,
  OpenTextInput,
  ParsedBinaryEnvelope,
  ParsedTextEnvelope,
  SealBytesInput,
  SealTextInput,
  TextEnvelope,
  WorkspaceCryptoContext,
} from "./envelope";
export {
  cancelEncryptionBeforeCommit,
  enableEncryption,
  inspectBaseEncryption,
  resumeEncryption,
  type BaseEncryptionInspection,
  type BaseEncryptionState,
  type CancelEncryptionOptions,
  type EnableEncryptionOptions,
  type EnableEncryptionResult,
  type MigrationDraftRecord,
  type MigrationDrafts,
  type MigrationDraftStore,
  type MigrationOptions,
  type MigrationPhase,
  type MigrationProgress,
  type ResumeEncryptionOptions,
} from "./migration";
export {
  createEncryptedStorage,
  type CreateEncryptedStorageOptions,
} from "./encrypted-storage";
export {
  rotateWorkspaceKey,
  type RotateWorkspaceKeyOptions,
  type RotateWorkspaceKeyResult,
} from "./rotation";
export {
  BACKUP_ALGORITHM,
  BACKUP_CHUNK_SIZE,
  BACKUP_ENCRYPTION_VERSION,
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  canonicalJsonBytes,
  createBackupKey,
  openBackup,
  sealBackup,
} from "./backup";
export type {
  BackupChunk,
  BackupCounts,
  BackupEncryptionHeader,
  BackupEnvelopeV2,
  BackupKeySource,
  BackupSummaryPayload,
  OpenBackupInput,
  OpenedBackup,
  SealBackupInput,
  SealedBackup,
} from "./backup";
export { CryptoError } from "./errors";
export type { CryptoErrorCode } from "./errors";
export { createIndexedDbKeyringStore } from "./indexeddb-keyring-store";
export type { IndexedDbKeyringStoreOptions } from "./indexeddb-keyring-store";
export {
  BACKUP_KEK_DOMAIN,
  KDF_SALT_BYTES,
  KEK_BYTES,
  MIN_PBKDF2_ITERATIONS,
  WORKSPACE_KEK_DOMAIN,
  createKdfParameters,
  deriveBackupKek,
  deriveKekBytes,
  deriveWorkspaceKek,
  hkdfBits,
  parseKdfParameters,
  pbkdf2Bits,
} from "./kdf";
export type { KdfParameters } from "./kdf";
export {
  MAX_UNLOCK_ATTEMPTS,
  UNLOCK_RETRY_MS,
  createKeyring,
  parseKeyringRecord,
} from "./keyring";
export type {
  CreateKeyringOptions,
  EncryptionState,
  Keyring,
  KeyringPassphraseChangeResult,
  KeyringRecordV1,
  KeyringSetupResult,
  PendingRotation,
  RecoveryKeySlot,
} from "./keyring";
export { createMemoryKeyringStore } from "./keyring-store";
export type { KeyringStore } from "./keyring-store";
export { getWebCrypto, randomBytes, randomId } from "./random";
export {
  decodeBackupKey,
  decodeRecoveryKey,
  encodeBackupKey,
  encodeRecoveryKey,
} from "./recovery-key";
export { createEncryptedSearch, type EncryptedSearchOptions } from "./search";
