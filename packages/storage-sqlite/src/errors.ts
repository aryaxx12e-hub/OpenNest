import {
  ConflictError,
  ConstraintError,
  DomainError,
  StorageError,
} from "@opennest/core";

function sqliteErrorCandidate(error: unknown): {
  code?: unknown;
  errcode?: unknown;
} | null {
  let current: unknown = error;

  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof current !== "object" || current === null) {
      return null;
    }

    const candidate = current as {
      code?: unknown;
      errcode?: unknown;
      cause?: unknown;
    };

    if (candidate.code === "ERR_SQLITE_ERROR" || typeof candidate.errcode === "number") {
      return candidate;
    }

    current = candidate.cause;
  }

  return null;
}

function sqliteErrcode(error: unknown): number | undefined {
  const errcode = sqliteErrorCandidate(error)?.errcode;

  return typeof errcode === "number" ? errcode : undefined;
}

function isSqliteError(error: unknown): boolean {
  return sqliteErrorCandidate(error) !== null;
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
