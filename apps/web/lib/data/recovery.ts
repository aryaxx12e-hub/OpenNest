export type RecoveryTip =
  "wrongKey" | "damaged" | "format" | "drafts" | "storage" | "generic";

const wrongKey = new Set(["backup.errors.wrongKey"]);

const damaged = new Set([
  "backup.errors.invalidEncryption",
  "backup.errors.invalidSummary",
  "backup.errors.invalidBlob",
  "backup.errors.checksumMismatch",
]);

const format = new Set([
  "backup.errors.invalidJson",
  "backup.errors.invalidFormat",
  "backup.errors.unsupportedVersion",
]);

const drafts = new Set(["backup.draftClearFailed"]);

const storage = new Set([
  "privacy.errors.storage_failed",
  "privacy.errors.draft_clear_failed",
  "errors.storage",
]);

export function recoveryTip(errorKey: string | null): RecoveryTip | null {
  if (errorKey === null) {
    return null;
  }

  if (wrongKey.has(errorKey)) {
    return "wrongKey";
  }

  if (damaged.has(errorKey)) {
    return "damaged";
  }

  if (format.has(errorKey)) {
    return "format";
  }

  if (drafts.has(errorKey)) {
    return "drafts";
  }

  if (storage.has(errorKey)) {
    return "storage";
  }

  return "generic";
}
