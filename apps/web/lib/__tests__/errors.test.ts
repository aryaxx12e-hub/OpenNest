import {
  ConflictError,
  ConstraintError,
  StorageError,
  ValidationError,
} from "@opennest/core";
import { describe, expect, it } from "vitest";

import { errorKey } from "../errors";

describe("errorKey", () => {
  it("maps domain errors to localized message keys", () => {
    expect(errorKey(new ValidationError("bad"))).toBe("errors.validation");
    expect(errorKey(new ConflictError("taken", "duplicate_tag_name"))).toBe(
      "errors.conflict"
    );
    expect(errorKey(new StorageError("full", "quota_exceeded"))).toBe("errors.storage");
    expect(errorKey(new ConstraintError("cycle", "folder_cycle"))).toBe(
      "errors.constraint"
    );
  });

  it("falls back to a general error for unknown values", () => {
    expect(errorKey(new Error("boom"))).toBe("errors.unexpected");
    expect(errorKey("boom")).toBe("errors.unexpected");
  });
});
