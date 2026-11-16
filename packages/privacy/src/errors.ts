export type PrivacyErrorCode =
  | "invalid_capability"
  | "invalid_scope"
  | "invalid_grant"
  | "invalid_audit"
  | "built_in_grant"
  | "unknown_grant"
  | "external_unavailable"
  | "expired"
  | "exhausted"
  | "revoked"
  | "mismatch"
  | "rate_limited"
  | "confirmation_required"
  | "confirmation_stale"
  | "audit_failed"
  | "storage_failed"
  | "draft_clear_failed";

export class PrivacyError extends Error {
  constructor(
    readonly code: PrivacyErrorCode,
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = "PrivacyError";
  }
}

const denialMessages: Record<string, string> = {
  external_unavailable: "This capability is not available in local-only mode.",
  unknown_grant: "No matching capability grant exists.",
  expired: "The capability grant has expired.",
  exhausted: "The capability grant has no uses left.",
  revoked: "The capability grant has been revoked.",
  mismatch: "The capability handle does not match this runtime.",
  rate_limited: "The capability call limit has been reached.",
  confirmation_required: "This action requires explicit confirmation.",
  confirmation_stale: "The confirmation is too old or has the wrong scope.",
  audit_failed: "The action was denied because the audit log could not be written.",
  storage_failed: "The privacy store could not be opened or updated.",
  draft_clear_failed: "The action was stopped because local drafts could not be cleared.",
};

export class CapabilityDeniedError extends PrivacyError {
  constructor(
    code: PrivacyErrorCode,
    message = denialMessages[code] ?? "Denied.",
    options?: { cause?: unknown }
  ) {
    super(code, message, options);
    this.name = "CapabilityDeniedError";
  }
}
