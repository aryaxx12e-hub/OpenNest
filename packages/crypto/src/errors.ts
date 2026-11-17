export type CryptoErrorCode =
  | "authentication_failed"
  | "already_exists"
  | "crypto_unavailable"
  | "invalid_aad"
  | "invalid_base64url"
  | "invalid_envelope"
  | "invalid_kdf_parameters"
  | "invalid_passphrase"
  | "invalid_recovery_key"
  | "invalid_wrapped_key"
  | "invalid_workspace_id"
  | "base_encrypted"
  | "keyring_corrupt"
  | "keyring_missing"
  | "keyring_store_failed"
  | "migration_cancelled"
  | "migration_failed"
  | "migration_state"
  | "no_pending_rotation"
  | "no_secure_random"
  | "pending_rotation"
  | "rate_limited"
  | "rotation_failed"
  | "rotation_state"
  | "unknown_key_id";

export class CryptoError extends Error {
  readonly code: CryptoErrorCode;

  constructor(code: CryptoErrorCode, message?: string, options?: ErrorOptions) {
    super(message ?? code, options);
    this.name = "CryptoError";
    this.code = code;
  }
}
