export type DomainErrorCode =
  | "validation"
  | "not_found"
  | "duplicate_id"
  | "duplicate_tag_name"
  | "missing_reference"
  | "folder_cycle"
  | "self_link"
  | "cross_workspace"
  | "unsafe_key"
  | "quota_exceeded"
  | "closed"
  | "nested_transaction"
  | "no_random_source"
  | "multiple_workspaces"
  | "corrupt_data";

export interface DomainErrorOptions {
  cause?: unknown;
}

export class DomainError extends Error {
  readonly code: DomainErrorCode;

  constructor(message: string, code: DomainErrorCode, options?: DomainErrorOptions) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
  }
}

export class ValidationError extends DomainError {
  constructor(message: string, options?: DomainErrorOptions) {
    super(message, "validation", options);
  }
}

export class NotFoundError extends DomainError {
  constructor(message: string, options?: DomainErrorOptions) {
    super(message, "not_found", options);
  }
}

export class ConflictError extends DomainError {
  constructor(
    message: string,
    code: Extract<DomainErrorCode, "duplicate_id" | "duplicate_tag_name">,
    options?: DomainErrorOptions
  ) {
    super(message, code, options);
  }
}

export class ConstraintError extends DomainError {
  constructor(
    message: string,
    code: Extract<
      DomainErrorCode,
      | "missing_reference"
      | "folder_cycle"
      | "self_link"
      | "cross_workspace"
      | "multiple_workspaces"
    >,
    options?: DomainErrorOptions
  ) {
    super(message, code, options);
  }
}

export class UnsafeKeyError extends DomainError {
  constructor(message: string, options?: DomainErrorOptions) {
    super(message, "unsafe_key", options);
  }
}

export class NoRandomSourceError extends DomainError {
  constructor(message: string, options?: DomainErrorOptions) {
    super(message, "no_random_source", options);
  }
}

export class StorageError extends DomainError {
  constructor(
    message: string,
    code: Extract<DomainErrorCode, "quota_exceeded" | "closed" | "corrupt_data">,
    options?: DomainErrorOptions
  ) {
    super(message, code, options);
  }
}

export class UnsupportedError extends DomainError {
  constructor(
    message: string,
    code: Extract<DomainErrorCode, "nested_transaction">,
    options?: DomainErrorOptions
  ) {
    super(message, code, options);
  }
}
