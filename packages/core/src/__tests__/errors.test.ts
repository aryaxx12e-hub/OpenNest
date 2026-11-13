import { describe, expect, it } from "vitest";

import {
  ConflictError,
  ConstraintError,
  DomainError,
  NotFoundError,
  NoRandomSourceError,
  StorageError,
  UnsafeKeyError,
  UnsupportedError,
  ValidationError,
} from "../errors";

describe("error hierarchy", () => {
  it("every error is a DomainError and an Error", () => {
    const errors = [
      new ValidationError("bad"),
      new NotFoundError("gone"),
      new ConflictError("conflict", "duplicate_id"),
      new ConstraintError("constraint", "missing_reference"),
      new UnsafeKeyError("key"),
      new NoRandomSourceError("no crypto"),
      new StorageError("storage", "corrupt_data"),
      new UnsupportedError("nope", "nested_transaction"),
    ];

    for (const error of errors) {
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(DomainError);
    }
  });

  it("keeps the class name and message", () => {
    const error = new NotFoundError("Folder not found");

    expect(error.code).toBe("not_found");
    expect(error.message).toBe("Folder not found");
    expect(error.name).toBe("NotFoundError");
  });

  it("defaults codes only where the domain has a single meaning", () => {
    expect(new ValidationError("x").code).toBe("validation");
    expect(new NotFoundError("x").code).toBe("not_found");
    expect(new UnsafeKeyError("x").code).toBe("unsafe_key");
    expect(new NoRandomSourceError("x").code).toBe("no_random_source");
  });

  it("takes the concrete code for multi-purpose errors", () => {
    const cases = [
      new ConflictError("id exists", "duplicate_id"),
      new ConflictError("duplicate tag", "duplicate_tag_name"),
      new ConstraintError("missing folder", "missing_reference"),
      new ConstraintError("cycle", "folder_cycle"),
      new ConstraintError("self link", "self_link"),
      new ConstraintError("other workspace", "cross_workspace"),
      new ConstraintError("two workspaces", "multiple_workspaces"),
      new StorageError("quota", "quota_exceeded"),
      new StorageError("closed", "closed"),
      new StorageError("corrupt", "corrupt_data"),
      new UnsupportedError("nested", "nested_transaction"),
    ];

    expect(cases.map((error) => error.code)).toEqual([
      "duplicate_id",
      "duplicate_tag_name",
      "missing_reference",
      "folder_cycle",
      "self_link",
      "cross_workspace",
      "multiple_workspaces",
      "quota_exceeded",
      "closed",
      "corrupt_data",
      "nested_transaction",
    ]);
  });

  it("keeps a driver failure as cause without leaking it as the message", () => {
    const driver = new Error("SQLITE_CONSTRAINT_UNIQUE");
    const error = new ConflictError("duplicate tag", "duplicate_tag_name", {
      cause: driver,
    });

    expect(error.cause).toBe(driver);
    expect(error.message).toBe("duplicate tag");
  });

  it("subclasses do not need to repeat the constructor boilerplate", () => {
    const error = new DomainError("base", "corrupt_data");

    expect(error.name).toBe("DomainError");
    expect(error.code).toBe("corrupt_data");
  });
});
