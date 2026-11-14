import { describe, expect, it } from "vitest";

import { extensionOf, uploadMimeType } from "../files";

describe("uploadMimeType", () => {
  it("keeps an allowed browser MIME type", () => {
    const file = new File([new Uint8Array([1])], "photo.bin", { type: "image/webp" });
    expect(uploadMimeType(file)).toBe("image/webp");
  });

  it("infers allowed types from common extensions", () => {
    expect(uploadMimeType(new File(["x"], "notes.md", { type: "" }))).toBe(
      "text/markdown"
    );
    expect(uploadMimeType(new File(["x"], "report.pdf", { type: "" }))).toBe(
      "application/pdf"
    );
  });

  it("rejects unknown types with an unsupported sentinel", () => {
    expect(
      uploadMimeType(new File(["x"], "setup.exe", { type: "application/x-msdownload" }))
    ).toBe("application/octet-stream");
  });
});

describe("extensionOf", () => {
  it("returns a lowercase extension or an empty string", () => {
    expect(extensionOf("Notes.MD")).toBe("md");
    expect(extensionOf("README")).toBe("");
  });
});
