import {
  ConflictError,
  ConstraintError,
  DomainError,
  StorageError,
} from "@opennest/core";

function sqliteErrcode(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  const errcode = (error as { errcode?: unknown }).errcode;

  return typeof errcode === "number" ? errcode : undefined;
}

function isSqliteError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const { code, errcode } = error as { code?: unknown; errcode?: unknown };

  return code === "ERR_SQLITE_ERROR" || typeof errcode === "number";
}

export function mapSqliteError(error: unknown): unknown {
  if (error instanceof DomainError) {
    return error;
  }

  switch (sqliteErrcode(error)) {
    case 13:
      return new StorageError("Storage is full.", "quota_exceeded", { cause: error });
    case 1555:
      return new ConflictError("A row with that id already exists.", "duplicate_id", {
        cause: error,
      });
    case 2067:
      return new ConflictError(
        "A tag with that name already exists.",
        "duplicate_tag_name",
        { cause: error }
      );
    case 787:
      return new ConstraintError(
        "A referenced row does not exist.",
        "missing_reference",
        {
          cause: error,
        }
      );
    default:
      break;
  }

  if (isSqliteError(error)) {
    return new StorageError("The storage layer failed.", "corrupt_data", {
      cause: error,
    });
  }

  return error;
}
