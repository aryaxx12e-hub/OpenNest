import {
  EXTENSION_ERROR_CODES,
  ExtensionError,
  type ExtensionCapability,
  type ExtensionDataScope,
  type ExtensionErrorCode,
} from "@opennest/extensions";

function isErrorCode(value: string): value is ExtensionErrorCode {
  return EXTENSION_ERROR_CODES.includes(value as ExtensionErrorCode);
}

export function extensionErrorCode(error: unknown): ExtensionErrorCode | null {
  if (error instanceof ExtensionError) {
    return error.code;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    isErrorCode(error.code)
  ) {
    return error.code;
  }

  return null;
}

export function extensionErrorKey(error: unknown): string {
  const code =
    typeof error === "string" && isErrorCode(error) ? error : extensionErrorCode(error);

  switch (code) {
    case "invalid_manifest":
    case "invalid_package":
    case "unsupported_format":
    case "unsupported_format_version":
    case "invalid_files":
      return "extensions.errors.invalidPackage";
    case "unsupported_tier":
      return "extensions.errors.unsupportedTier";
    case "unsupported_capability":
      return "extensions.errors.unsupportedCapability";
    case "unsupported_network":
      return "extensions.errors.unsupportedNetwork";
    case "package_too_large":
    case "code_too_large":
      return "extensions.errors.tooLarge";
    case "integrity_mismatch":
      return "extensions.errors.integrity";
    case "ui_invalid":
      return "extensions.errors.uiInvalid";
    case "invalid_version":
    case "version_downgrade":
    case "version_conflict":
    case "already_installed":
      return "extensions.errors.version";
    case "publisher_mismatch":
      return "extensions.errors.publisher";
    case "host_version_unsupported":
      return "extensions.errors.hostVersion";
    case "consent_required":
      return "extensions.errors.consent";
    case "extension_not_found":
      return "extensions.errors.notFound";
    case "extension_disabled":
      return "extensions.errors.disabled";
    case "safe_mode":
      return "extensions.errors.safeMode";
    case "rate_limited":
      return "extensions.errors.rateLimited";
    case "timeout":
    case "session_expired":
      return "extensions.errors.expired";
    case "busy":
      return "extensions.errors.busy";
    case "runtime_disposed":
      return "extensions.errors.unavailable";
    case "invalid_request":
    case "invalid_params":
    case "unknown_method":
    case "unknown_grant":
    case "protocol_error":
      return "extensions.errors.protocol";
    case "response_too_large":
      return "extensions.errors.responseTooLarge";
    case "storage_failed":
    case "storage_key":
    case "storage_quota":
    case "storage_value_too_large":
      return "extensions.errors.storage";
    default:
      return "extensions.errors.generic";
  }
}

const CAPABILITY_KEYS: Record<ExtensionCapability, string> = {
  "workspace.read.metadata": "extensions.capabilities.metadata",
  "workspace.read.content": "extensions.capabilities.content",
};

export function extensionCapabilityKey(capability: ExtensionCapability): string {
  return CAPABILITY_KEYS[capability];
}

const DATA_SCOPE_KEYS: Record<ExtensionDataScope, string> = {
  notes: "extensions.dataScopes.notes",
  files: "extensions.dataScopes.files",
  folders: "extensions.dataScopes.folders",
  tags: "extensions.dataScopes.tags",
};

export function extensionDataScopeKey(scope: ExtensionDataScope): string {
  return DATA_SCOPE_KEYS[scope];
}
