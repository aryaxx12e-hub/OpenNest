import { describe, expect, it } from "vitest";

import { limits } from "../limits";

describe("limits", () => {
  it("exposes the documented numeric caps", () => {
    expect(limits.maxNameLength).toBe(255);
    expect(limits.maxNoteTitleLength).toBe(200);
    expect(limits.maxNoteContentLength).toBe(1_000_000);
    expect(limits.maxTagNameLength).toBe(50);
    expect(limits.maxFileSizeBytes).toBe(26_214_400);
    expect(limits.maxFileSizeBytes).toBe(25 * 1024 * 1024);
  });

  it("allows the documented MIME types and nothing else", () => {
    expect(limits.allowedMimeTypes).toEqual([
      "application/pdf",
      "text/plain",
      "text/markdown",
      "image/png",
      "image/jpeg",
      "image/webp",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ]);
  });

  it("is frozen so a consumer cannot mutate shared limits", () => {
    expect(Object.isFrozen(limits)).toBe(true);
    expect(Object.isFrozen(limits.allowedMimeTypes)).toBe(true);
  });

  it("checksum length matches sha-256 hex", () => {
    expect(limits.checksumHexLength).toBe(64);
  });

  it("bounds paged reads at the largest limit the services request", () => {
    expect(limits.maxPageSize).toBe(500);
  });

  it("bounds search input to a length the FTS builders accept", () => {
    expect(limits.maxSearchTextLength).toBe(1_000);
  });
});
