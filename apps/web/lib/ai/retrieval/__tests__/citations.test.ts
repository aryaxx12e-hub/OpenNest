import { describe, expect, it } from "vitest";

import { escapeCitationText, validateCitations } from "../citations";
import type { Passage } from "../types";

function passage(id: string, text: string): Passage {
  return {
    id,
    kind: "note",
    sourceId: "note-1",
    sourceTitle: "Belanja",
    text,
    start: 0,
    end: text.length,
  };
}

const passages = [passage("p1", "Belanja sayur."), passage("p2", "Belanja buah.")];

describe("citations", () => {
  it("keeps only known citations in supplied order", () => {
    const result = validateCitations(
      "Sayur lebih murah [[p1]] dan buah juga [[p2]].",
      passages
    );

    expect(result.citations.map((citation) => citation.id)).toEqual(["p1", "p2"]);
    expect(result.unsupported).toBe(false);
    expect(result.answer).not.toContain("[[");
  });

  it("removes unknown citations and marks an answer unsupported", () => {
    const unknown = validateCitations("Kata model [[missing]].", passages);
    const mixed = validateCitations("Sayur [[p1]] dan palsu [[missing]].", passages);

    expect(unknown.citations).toEqual([]);
    expect(unknown.unsupported).toBe(true);
    expect(unknown.answer).not.toContain("missing");

    expect(mixed.citations.map((citation) => citation.id)).toEqual(["p1"]);
    expect(mixed.unsupported).toBe(false);
    expect(mixed.answer).not.toContain("missing");
  });

  it("deduplicates repeated citations", () => {
    const result = validateCitations("[[p1]] lalu [[p1]] lagi.", passages);

    expect(result.citations.map((citation) => citation.id)).toEqual(["p1"]);
  });

  it("marks an answer without citations unsupported", () => {
    const result = validateCitations("Jawaban tanpa sumber.", passages);

    expect(result.citations).toEqual([]);
    expect(result.unsupported).toBe(true);
  });

  it("escapes citation text", () => {
    expect(escapeCitationText('<img src=x onerror="alert(1)"> & harga')).toBe(
      "&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; harga"
    );
    expect(escapeCitationText("O'Brien")).toBe("O&#39;Brien");
  });
});
