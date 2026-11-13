import { describe, expect, it } from "vitest";

import { ConstraintError, UnsafeKeyError, ValidationError } from "../errors";
import {
  assertNoSelfLink,
  assertSafeBlobKey,
  normalizeForSearch,
  normalizeName,
  normalizeTagName,
  searchTokens,
  toMatchQuery,
  validateDisplayName,
  validateNoteInput,
  validateTagColor,
  validateChecksum,
  validateUpload,
} from "../rules";

const UUID = "3f2b8c1e-9d4a-4f6b-8c2d-1a2b3c4d5e6f";

describe("normalizeName", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeName("  Kerja  ")).toBe("Kerja");
  });

  it("rejects empty and whitespace-only names", () => {
    expect(() => normalizeName("")).toThrow(ValidationError);
    expect(() => normalizeName("   \t\n ")).toThrow(ValidationError);
  });

  it("accepts exactly 255 characters and rejects 256", () => {
    expect(normalizeName("a".repeat(255))).toHaveLength(255);
    expect(() => normalizeName("a".repeat(256))).toThrow(ValidationError);
  });

  it("measures length after trimming, not before", () => {
    expect(normalizeName(`  ${"a".repeat(255)}  `)).toHaveLength(255);
  });
});

describe("validateDisplayName", () => {
  it("accepts ordinary names including Indonesian text", () => {
    expect(validateDisplayName("Dokumen Penting")).toBe("Dokumen Penting");
    expect(validateDisplayName("Rencana 2026")).toBe("Rencana 2026");
  });

  it("rejects forward and backward slashes", () => {
    expect(() => validateDisplayName("a/b")).toThrow(ValidationError);
    expect(() => validateDisplayName("a\\b")).toThrow(ValidationError);
  });

  it("rejects control characters", () => {
    expect(() => validateDisplayName("a\u0000b")).toThrow(ValidationError);
    expect(() => validateDisplayName("a\nb")).toThrow(ValidationError);
    expect(() => validateDisplayName("a\u007fb")).toThrow(ValidationError);
  });

  it("rejects leading and trailing dots", () => {
    expect(() => validateDisplayName(".hidden")).toThrow(ValidationError);
    expect(() => validateDisplayName("trailing.")).toThrow(ValidationError);
    expect(validateDisplayName("mid.dle")).toBe("mid.dle");
  });

  it("rejects the reserved dot segments", () => {
    expect(() => validateDisplayName(".")).toThrow(ValidationError);
    expect(() => validateDisplayName("..")).toThrow(ValidationError);
  });
});

describe("assertSafeBlobKey", () => {
  it("accepts a valid uuid v4", () => {
    expect(() => assertSafeBlobKey(UUID)).not.toThrow();
  });

  it("rejects traversal and absolute paths", () => {
    expect(() => assertSafeBlobKey("..")).toThrow(UnsafeKeyError);
    expect(() => assertSafeBlobKey("../etc/passwd")).toThrow(UnsafeKeyError);
    expect(() => assertSafeBlobKey("/etc/passwd")).toThrow(UnsafeKeyError);
    expect(() => assertSafeBlobKey("a/b")).toThrow(UnsafeKeyError);
  });

  it("rejects non-uuid strings", () => {
    expect(() => assertSafeBlobKey("not-a-uuid")).toThrow(UnsafeKeyError);
    expect(() => assertSafeBlobKey("")).toThrow(UnsafeKeyError);
    expect(() => assertSafeBlobKey(UUID.toUpperCase())).toThrow(UnsafeKeyError);
    expect(() => assertSafeBlobKey(`${UUID} `)).toThrow(UnsafeKeyError);
  });

  it("rejects a uuid with a different version or variant", () => {
    expect(() => assertSafeBlobKey(UUID.replace("-4f6b", "-1f6b"))).toThrow(
      UnsafeKeyError
    );
    expect(() => assertSafeBlobKey(UUID.replace("-8c2d", "-cc2d"))).toThrow(
      UnsafeKeyError
    );
  });
});

describe("validateUpload", () => {
  const good = { name: "laporan.pdf", mimeType: "application/pdf", sizeBytes: 1024 };

  it("accepts every documented MIME type", () => {
    for (const mimeType of [
      "application/pdf",
      "text/plain",
      "text/markdown",
      "image/png",
      "image/jpeg",
      "image/webp",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ]) {
      expect(() => validateUpload({ ...good, mimeType })).not.toThrow();
    }
  });

  it("accepts a zero-byte file and rejects a negative size", () => {
    expect(() => validateUpload({ ...good, sizeBytes: 0 })).not.toThrow();
    expect(() => validateUpload({ ...good, sizeBytes: -1 })).toThrow(ValidationError);
  });

  it("accepts exactly 25 MiB and rejects one byte more", () => {
    expect(() => validateUpload({ ...good, sizeBytes: 26_214_400 })).not.toThrow();
    expect(() => validateUpload({ ...good, sizeBytes: 26_214_401 })).toThrow(
      ValidationError
    );
  });

  it("rejects an unknown MIME type", () => {
    expect(() => validateUpload({ ...good, mimeType: "application/zip" })).toThrow(
      ValidationError
    );
  });

  it("accepts a null MIME type because PRD allows the column to be null", () => {
    expect(() => validateUpload({ ...good, mimeType: null })).not.toThrow();
  });

  it("rejects a size that is not a finite integer", () => {
    expect(() => validateUpload({ ...good, sizeBytes: Number.NaN })).toThrow(
      ValidationError
    );
    expect(() => validateUpload({ ...good, sizeBytes: 1.5 })).toThrow(ValidationError);
    expect(() => validateUpload({ ...good, sizeBytes: Infinity })).toThrow(
      ValidationError
    );
  });
});

describe("normalizeTagName", () => {
  it("returns the trimmed display name and a folded key", () => {
    expect(normalizeTagName("  Kerja  ")).toEqual({ display: "Kerja", key: "kerja" });
  });

  it("makes case and internal whitespace differences compare equal", () => {
    const a = normalizeTagName("New   Tag");
    const b = normalizeTagName("new tag");

    expect(a.display).toBe("New   Tag");
    expect(a.key).toBe("new tag");
    expect(a.key).toBe(b.key);
  });

  it("rejects empty names and accepts exactly 50 characters", () => {
    expect(() => normalizeTagName("   ")).toThrow(ValidationError);
    expect(normalizeTagName("a".repeat(50)).display).toHaveLength(50);
    expect(() => normalizeTagName("a".repeat(51))).toThrow(ValidationError);
  });

  it("folds only case and whitespace, not diacritics", () => {
    expect(normalizeTagName("Café").key).toBe("café");
  });
});

describe("validateTagColor", () => {
  it("accepts null and a six-digit hex colour", () => {
    expect(validateTagColor(null)).toBeNull();
    expect(validateTagColor("#a1b2c3")).toBe("#a1b2c3");
    expect(validateTagColor("#A1B2C3")).toBe("#a1b2c3");
  });

  it("rejects short hex, names, and malformed prefixes", () => {
    for (const colour of ["#fff", "red", "a1b2c3", "#a1b2c", "#a1b2c3d", "#gggggg"]) {
      expect(() => validateTagColor(colour)).toThrow(ValidationError);
    }
  });
});

describe("validateNoteInput", () => {
  it("trims the title and defaults content to an empty string", () => {
    expect(validateNoteInput({ title: "  Rencana  " })).toEqual({
      title: "Rencana",
      content: "",
    });
  });

  it("rejects an empty title and accepts exactly 200 characters", () => {
    expect(() => validateNoteInput({ title: "  " })).toThrow(ValidationError);
    expect(validateNoteInput({ title: "a".repeat(200) }).title).toHaveLength(200);
    expect(() => validateNoteInput({ title: "a".repeat(201) })).toThrow(ValidationError);
  });

  it("accepts content up to 1,000,000 characters and rejects more", () => {
    expect(
      validateNoteInput({ title: "t", content: "a".repeat(1_000_000) })
    ).toBeTruthy();
    expect(() =>
      validateNoteInput({ title: "t", content: "a".repeat(1_000_001) })
    ).toThrow(ValidationError);
  });

  it("keeps content verbatim, including newlines", () => {
    expect(validateNoteInput({ title: "t", content: "a\n\nb  " }).content).toBe(
      "a\n\nb  "
    );
  });
});

describe("assertNoSelfLink", () => {
  it("rejects a note linking to itself", () => {
    expect(() => assertNoSelfLink("note-1", "note-1")).toThrow(ConstraintError);
  });

  it("accepts a link between different notes", () => {
    expect(() => assertNoSelfLink("note-1", "note-2")).not.toThrow();
  });

  it("uses the self_link code", () => {
    try {
      assertNoSelfLink("note-1", "note-1");
    } catch (error) {
      expect((error as ConstraintError).code).toBe("self_link");
    }
  });
});

describe("normalizeForSearch", () => {
  it("lowercases and collapses whitespace", () => {
    expect(normalizeForSearch("  Belanja   Bulanan  ")).toBe("belanja bulanan");
  });

  it("strips diacritics", () => {
    expect(normalizeForSearch("Café Résumé")).toBe("cafe resume");
  });

  it("leaves plain Indonesian text intact", () => {
    expect(normalizeForSearch("Dokumen Penting")).toBe("dokumen penting");
  });

  it("collapses tabs and newlines to single spaces", () => {
    expect(normalizeForSearch("a\t\tb\n\nc")).toBe("a b c");
  });
});

describe("searchTokens", () => {
  it("splits folded text on whitespace", () => {
    expect(searchTokens("Belanja  Bulanan")).toEqual(["belanja", "bulanan"]);
  });

  it("drops tokens that are only punctuation", () => {
    expect(searchTokens('"*() - foo')).toEqual(["foo"]);
  });

  it("returns an empty array for empty or punctuation-only input", () => {
    expect(searchTokens("")).toEqual([]);
    expect(searchTokens("   ")).toEqual([]);
    expect(searchTokens('*()"-')).toEqual([]);
  });
});

describe("toMatchQuery", () => {
  it("quotes every token and prefixes each one", () => {
    expect(toMatchQuery("belanja bulan")).toBe('"belanja"* "bulan"*');
  });

  it("produces the documented example for mixed case and whitespace", () => {
    expect(normalizeForSearch("Belanja  Bulanan")).toBe("belanja bulanan");
    expect(searchTokens("Belanja  Bulanan")).toEqual(["belanja", "bulanan"]);
    expect(toMatchQuery("Belanja  Bulanan")).toBe('"belanja"* "bulanan"*');
  });

  it("keeps attached punctuation as part of the token, as documented", () => {
    expect(toMatchQuery("bulanan!")).toBe('"bulanan!"*');
    expect(searchTokens("belanja - bulanan")).toEqual(["belanja", "bulanan"]);
  });

  it("does not match a word by interior substring", () => {
    expect(toMatchQuery("oat")).toBe('"oat"*');
  });

  it("doubles embedded quotes so FTS5 sees one literal quote", () => {
    expect(toMatchQuery('a"b')).toBe('"a""b"*');
  });

  it("neutralises FTS5 operators and syntax characters", () => {
    const hostile = ["OR", "NEAR(a b)", "a*", "(b)", "-c", "AND", "NOT", '""', "'''"];

    for (const input of hostile) {
      const query = toMatchQuery(input);

      if (query === "") {
        continue;
      }

      for (const part of query.split(" ")) {
        expect(part).toMatch(/^"(?:[^"]|"")*"\*$/);
      }
    }
  });

  it("never throws on any hostile query", () => {
    const corpus = [
      '"',
      "*",
      "(",
      ")",
      "-",
      "NEAR",
      "OR",
      "AND",
      "NOT",
      '""""',
      "a AND b",
      "a OR b",
      "NEAR(a b)",
      "col:val",
      "^caret",
      "{a b}",
      "\\",
      "%",
      "_",
      "\u0000",
      "😀",
      "a".repeat(10_000),
    ];

    for (const input of corpus) {
      expect(() => toMatchQuery(input)).not.toThrow();
    }
  });

  it("returns an empty string when nothing searchable remains", () => {
    expect(toMatchQuery("")).toBe("");
    expect(toMatchQuery("   ")).toBe("");
    expect(toMatchQuery("*()-")).toBe("");
  });
});

describe("validateChecksum", () => {
  const HEX = "a".repeat(64);

  it("accepts null", () => {
    expect(validateChecksum(null)).toBeNull();
  });

  it("accepts a lowercase sha-256 digest unchanged", () => {
    expect(validateChecksum(HEX)).toBe(HEX);
  });

  it("lowercases an uppercase digest so storage sees one form", () => {
    expect(validateChecksum(HEX.toUpperCase())).toBe(HEX);
  });

  it("rejects a digest of the wrong length", () => {
    expect(() => validateChecksum("a".repeat(63))).toThrow(ValidationError);
    expect(() => validateChecksum("a".repeat(65))).toThrow(ValidationError);
  });

  it("rejects non-hex characters", () => {
    expect(() => validateChecksum("g".repeat(64))).toThrow(ValidationError);
    expect(() => validateChecksum(`${"a".repeat(63)}z`)).toThrow(ValidationError);
  });

  it("rejects an empty string rather than treating it as null", () => {
    expect(() => validateChecksum("")).toThrow(ValidationError);
  });
});
