import {
  ConflictError,
  ConstraintError,
  NotFoundError,
  StorageError,
  ValidationError,
} from "@opennest/core";

export function errorKey(error: unknown): string {
  if (error instanceof ValidationError) {
    return "errors.validation";
  }

  if (error instanceof ConflictError) {
    return "errors.conflict";
  }

  if (error instanceof NotFoundError) {
    return "errors.notFound";
  }

  if (error instanceof ConstraintError) {
    return "errors.constraint";
  }

  if (error instanceof StorageError) {
    return "errors.storage";
  }

  return "errors.unexpected";
}
