export type AiErrorCode =
  | "invalid_provider"
  | "invalid_provider_id"
  | "invalid_label"
  | "invalid_adapter"
  | "unsupported_provider_kind"
  | "invalid_endpoint"
  | "origin_mismatch"
  | "invalid_models"
  | "duplicate_model"
  | "invalid_capability"
  | "unsupported_capability"
  | "duplicate_capability"
  | "invalid_auth"
  | "invalid_data_policy_url"
  | "invalid_token_limit"
  | "unknown_provider"
  | "ai_disabled"
  | "invalid_request"
  | "invalid_message"
  | "invalid_data_class"
  | "invalid_model"
  | "model_not_allowed"
  | "invalid_temperature"
  | "invalid_max_tokens"
  | "request_too_large"
  | "payload_changed"
  | "authentication_failed"
  | "permission_denied"
  | "rate_limited"
  | "provider_error"
  | "malformed_response"
  | "network_error"
  | "aborted"
  | "timeout"
  | "response_too_large"
  | "credential_missing"
  | "credential_provider_mismatch"
  | "unexpected_credential"
  | "redirect_blocked"
  | "storage_failed"
  | "runtime_disposed";

export class AiError extends Error {
  readonly code: AiErrorCode;

  constructor(code: AiErrorCode, message?: string, options?: ErrorOptions) {
    super(message ?? code, options);
    this.name = "AiError";
    this.code = code;
  }
}
