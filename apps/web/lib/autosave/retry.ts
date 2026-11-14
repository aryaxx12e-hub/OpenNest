import { DomainError, StorageError } from "@opennest/core";

export const SAVE_RETRY_DELAYS_MS = [1_000, 2_000] as const;

export function isRetryableSaveError(error: unknown): boolean {
  if (error instanceof StorageError) {
    return error.code === "corrupt_data";
  }

  return !(error instanceof DomainError);
}
