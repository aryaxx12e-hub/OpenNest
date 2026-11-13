import { DomainError, StorageError } from "@opennest/core";

const DEXIE_ERROR_NAMES = new Set([
  "ConstraintError",
  "DataError",
  "DatabaseClosedError",
  "VersionError",
  "AbortError",
  "OpenFailedError",
  "ReadOnlyError",
  "TransactionInactiveError",
  "PrematureCommitError",
  "ForeignAwaitError",
  "QuotaExceededError",
  "UnknownError",
]);

export function isDexieError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { name?: unknown }).name === "string" &&
    DEXIE_ERROR_NAMES.has((error as { name: string }).name)
  );
}

export function mapStorageError(error: unknown): unknown {
  if (error instanceof DomainError) {
    return error;
  }

  const name =
    typeof error === "object" && error !== null
      ? (error as { name?: unknown }).name
      : undefined;

  switch (name) {
    case "QuotaExceededError":
      return new StorageError("Storage quota is exhausted.", "quota_exceeded", {
        cause: error,
      });
    case "DatabaseClosedError":
      return new StorageError("The storage adapter is closed.", "closed", {
        cause: error,
      });
    case "ConstraintError":
      return new StorageError(
        "A unique constraint was violated inside a transaction.",
        "corrupt_data",
        { cause: error }
      );
    case "VersionError":
    case "AbortError":
    case "DataError":
    case "OpenFailedError":
    case "ReadOnlyError":
    case "TransactionInactiveError":
    case "PrematureCommitError":
    case "ForeignAwaitError":
    case "UnknownError":
      return new StorageError("The storage layer failed.", "corrupt_data", {
        cause: error,
      });
    default:
      return error;
  }
}
