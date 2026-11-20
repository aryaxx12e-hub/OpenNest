import { describe, expect, it } from "vitest";

import { chunkSource, chunkSources } from "../chunk";
import type { PassageSource } from "../types";

function noteSource(text: string): PassageSource {
  return {
    kind: "note",
    id: "note-1",
    title: "Belanja bulanan",
    text,
    mimeType: "text/markdown",
  };
}

function fileSource(text: string, mimeType: string | null): PassageSource {
  return {
    kind: "file",
    id: "file-1",
    title: "Catatan.txt",
    text,
    mimeType,
  };
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

describe("chunking", () => {
  it("chunks notes with stable passage IDs and exact ranges", () => {
    const text = "Alpha beta gamma.\n\nDelta epsilon zeta.\n\nEta theta iota.";
    const source = noteSource(text);
    const first = chunkSource(source, { maxChars: 30 });
    const second = chunkSource(source, { maxChars: 30 });

    expect(first.length).toBeGreaterThan(1);
    expect(first.map((passage) => passage.id)).toEqual(
      second.map((passage) => passage.id)
    );

    for (const passage of first) {
      expect(passage.text).toBe(text.slice(passage.start, passage.end));
      expect(passage.sourceId).toBe(source.id);
      expect(passage.sourceTitle).toBe(source.title);
      expect(passage.kind).toBe("note");
    }

    expect(new Set(first.map((passage) => passage.id)).size).toBe(first.length);
  });

  it("changes passage IDs when content or range changes", () => {
    const first = chunkSource(noteSource("Alpha beta."), { maxChars: 50 })[0];
    const changed = chunkSource(noteSource("Alpha gamma."), { maxChars: 50 })[0];
    const longer = chunkSource(noteSource("Alpha beta gamma."), { maxChars: 50 })[0];

    expect(first?.id).toBeDefined();
    expect(changed?.id).not.toBe(first?.id);
    expect(longer?.id).not.toBe(first?.id);
  });

  it("accepts Markdown and plain text files but excludes PDFs and binaries", () => {
    expect(chunkSource(fileSource("Plain text.", "text/plain")).length).toBe(1);
    expect(chunkSource(fileSource("# Markdown", "text/markdown")).length).toBe(1);
    expect(chunkSource(fileSource("PDF words", "application/pdf"))).toEqual([]);
    expect(chunkSource(fileSource("Binary", "application/octet-stream"))).toEqual([]);
    expect(chunkSource(fileSource("Image", "image/png"))).toEqual([]);
    expect(chunkSource(fileSource("Unknown", null))).toEqual([]);
  });

  it("splits long paragraphs and preserves offsets", () => {
    const text = "abcdefghijklmnopqrstuvwxyz";
    const passages = chunkSource(noteSource(text), { maxChars: 10 });

    expect(passages.length).toBe(3);
    expect(passages.map((passage) => passage.text)).toEqual([
      "abcdefghij",
      "klmnopqrst",
      "uvwxyz",
    ]);
    expect(passages.map((passage) => passage.start)).toEqual([0, 10, 20]);
    expect(passages.map((passage) => passage.end)).toEqual([10, 20, 26]);
  });

  it("bounds chunk count and total bytes across sources", () => {
    const text = "kata penting ".repeat(5000);
    const sources = [noteSource(text), noteSource(text), fileSource(text, "text/plain")];
    const passages = chunkSources(sources, {
      maxChars: 1000,
      maxPassages: 3,
      maxBytes: 4000,
    });

    expect(passages.length).toBeLessThanOrEqual(3);
    expect(
      passages.reduce((total, passage) => total + byteLength(passage.text), 0)
    ).toBeLessThanOrEqual(4000);
  });

  it("returns no passages for empty content", () => {
    expect(chunkSource(noteSource(""), {})).toEqual([]);
    expect(chunkSource(noteSource("   \n\n  "), {})).toEqual([]);
  });
});
