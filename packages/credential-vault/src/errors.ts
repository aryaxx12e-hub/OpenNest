export type CredentialVaultErrorCode =
  | "authentication_failed"
  | "entry_corrupt"
  | "entry_not_found"
  | "invalid_account_label"
  | "invalid_auto_lock"
  | "invalid_passphrase"
  | "invalid_provider_id"
  | "invalid_secret"
  | "provider_mismatch"
  | "rate_limited"
  | "vault_corrupt"
  | "vault_exists"
  | "vault_full"
  | "vault_locked"
  | "vault_missing"
  | "vault_session_expired";

export class CredentialVaultError extends Error {
  readonly code: CredentialVaultErrorCode;

  constructor(code: CredentialVaultErrorCode, message?: string, options?: ErrorOptions) {
    super(message ?? code, options);
    this.name = "CredentialVaultError";
    this.code = code;
  }
}
