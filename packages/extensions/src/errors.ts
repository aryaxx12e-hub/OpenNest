export const EXTENSION_ERROR_CODES = [
  "invalid_manifest",
  "invalid_package",
  "unsupported_format",
  "unsupported_format_version",
  "unsupported_tier",
  "unsupported_capability",
  "unsupported_network",
  "invalid_files",
  "package_too_large",
  "code_too_large",
  "integrity_mismatch",
  "ui_invalid",
  "invalid_version",
  "storage_value_too_large",
  "storage_key",
  "storage_quota",
  "storage_failed",
  "consent_required",
  "version_downgrade",
  "version_conflict",
  "already_installed",
  "publisher_mismatch",
  "host_version_unsupported",
  "extension_not_found",
  "extension_disabled",
  "safe_mode",
  "invalid_request",
  "invalid_params",
  "unknown_method",
  "unknown_grant",
  "rate_limited",
  "busy",
  "timeout",
  "session_expired",
  "protocol_error",
  "response_too_large",
  "runtime_disposed",
] as const;

export type ExtensionErrorCode = (typeof EXTENSION_ERROR_CODES)[number];

export class ExtensionError extends Error {
  readonly code: ExtensionErrorCode;

  constructor(code: ExtensionErrorCode, message: string = code, options?: ErrorOptions) {
    super(`${code}: ${message}`, options);
    this.name = "ExtensionError";
    this.code = code;
  }
}
