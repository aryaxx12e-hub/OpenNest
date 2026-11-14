import { describe, expect, it } from "vitest";

import { noteExcerpt } from "../notes";

describe("noteExcerpt", () => {
  it("strips common Markdown markers and collapses whitespace", () => {
    expect(noteExcerpt("# Title\n\n- one\n- **two** with `code`")).toBe(
      "Title one two with code"
    );
  });

  it("turns links into their labels and drops images", () => {
    expect(noteExcerpt("See [docs](https://example.com) ![alt](image.png)")).toBe(
      "See docs"
    );
  });

  it("truncates with an ASCII ellipsis", () => {
    expect(noteExcerpt("a".repeat(200), 10)).toBe("aaaaaaaaaa...");
  });

  it("returns an empty string for an empty note", () => {
    expect(noteExcerpt("   \n# ")).toBe("");
  });
});
