import { CapabilityDeniedError, PrivacyError } from "@opennest/privacy";

import { BackupError, backupErrorKey } from "../data/backup";
import { errorKey } from "../errors";

export function privacyErrorKey(error: unknown): string {
  if (error instanceof CapabilityDeniedError) {
    return `privacy.errors.${error.code}`;
  }

  if (error instanceof PrivacyError) {
    return `privacy.errors.${error.code}`;
  }

  return errorKey(error);
}

export function dataControlErrorKey(error: unknown): string {
  return error instanceof BackupError ? backupErrorKey(error) : privacyErrorKey(error);
}
