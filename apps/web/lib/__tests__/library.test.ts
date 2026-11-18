import { describe, expect, it } from "vitest";

import { libraryTypeMimeTypes } from "../library";

describe("libraryTypeMimeTypes", () => {
  it("returns no filter for all files", () => {
    expect(libraryTypeMimeTypes("all")).toBeUndefined();
  });

  it("returns document MIME types", () => {
    expect(libraryTypeMimeTypes("documents")).toEqual([
      "application/pdf",
      "text/plain",
      "text/markdown",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ]);
  });

  it("returns image MIME types", () => {
    expect(libraryTypeMimeTypes("images")).toEqual([
      "image/png",
      "image/jpeg",
      "image/webp",
    ]);
  });
});
