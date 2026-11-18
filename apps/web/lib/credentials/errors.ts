export type CredentialRuntimeErrorCode =
  | "storage_failed"
  | "vault_locked"
  | "credential_not_found"
  | "provider_mismatch"
  | "invalid_provider_id"
  | "invalid_account_label"
  | "invalid_secret"
  | "invalid_handle"
  | "runtime_disposed";

export class CredentialRuntimeError extends Error {
  readonly code: CredentialRuntimeErrorCode;

  constructor(code: CredentialRuntimeErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CredentialRuntimeError";
    this.code = code;
  }
}
