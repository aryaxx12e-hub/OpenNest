import { describe, expect, it } from "vitest";

import { noteExcerpt, noteMarkdownDocument, noteMarkdownFileName } from "../notes";

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

describe("noteMarkdownFileName", () => {
  it("sanitizes path characters and keeps a markdown extension", () => {
    expect(noteMarkdownFileName('../A:B? "C"|D*')).toBe("-A-B- -C--D-.md");
  });

  it("falls back to note.md for an empty title", () => {
    expect(noteMarkdownFileName("   ")).toBe("note.md");
  });

  it("limits the base name to 80 characters", () => {
    expect(noteMarkdownFileName("a".repeat(100))).toBe(`${"a".repeat(80)}.md`);
  });
});

describe("noteMarkdownDocument", () => {
  it("uses the title as a heading and preserves the content", () => {
    expect(noteMarkdownDocument("Shopping", "- milk\n- eggs")).toBe(
      "# Shopping\n\n- milk\n- eggs\n"
    );
  });

  it("uses a readable heading for an empty title", () => {
    expect(noteMarkdownDocument("", "body")).toBe("# Untitled note\n\nbody\n");
  });
});
