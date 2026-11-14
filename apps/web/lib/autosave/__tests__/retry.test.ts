import { describe, expect, it } from "vitest";

import {
  ConflictError,
  ConstraintError,
  NotFoundError,
  StorageError,
  ValidationError,
} from "@opennest/core";

import { isRetryableSaveError } from "../retry";

describe("save retry policy", () => {
  it("retries transient storage and unknown failures", () => {
    expect(isRetryableSaveError(new StorageError("temporary", "corrupt_data"))).toBe(
      true
    );
    expect(isRetryableSaveError(new Error("network hiccup"))).toBe(true);
  });

  it("does not retry exhausted quota or a closed adapter", () => {
    expect(isRetryableSaveError(new StorageError("full", "quota_exceeded"))).toBe(false);
    expect(isRetryableSaveError(new StorageError("closed", "closed"))).toBe(false);
  });

  it("does not retry deterministic domain failures", () => {
    expect(isRetryableSaveError(new ValidationError("invalid"))).toBe(false);
    expect(isRetryableSaveError(new NotFoundError("missing note"))).toBe(false);
    expect(isRetryableSaveError(new ConflictError("duplicate", "duplicate_id"))).toBe(
      false
    );
    expect(
      isRetryableSaveError(new ConstraintError("missing reference", "missing_reference"))
    ).toBe(false);
  });
});
