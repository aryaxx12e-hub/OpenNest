import { describe, expect, it } from "vitest";

import {
  blobKeySchema,
  checksumSchema,
  displayNameSchema,
  folderIdSchema,
  isoDateSchema,
  mimeTypeSchema,
  noteContentSchema,
  noteTitleSchema,
  pageLimitSchema,
  searchTextSchema,
  sizeBytesSchema,
  tagColorSchema,
  tagNameSchema,
} from "../common";

const V4 = "3f2b8c1e-9d4a-4f6b-8c2d-1a2b3c4d5e6f";
const V4_UPPER = "3F2B8C1E-9D4A-4F6B-8C2D-1A2B3C4D5E6F";
const V1 = "3f2b8c1e-9d4a-1f6b-8c2d-1a2b3c4d5e6f";
const HEX = "a".repeat(64);

function firstIssue(
  schema: { safeParse: (value: unknown) => { success: boolean; error?: unknown } },
  value: unknown
) {
  const result = schema.safeParse(value);

  if (result.success) {
    throw new Error("expected a failure");
  }

  const issues = (result as { error: { issues: { params?: unknown }[] } }).error.issues;

  return issues[0];
}

describe("folderIdSchema", () => {
  it("accepts a lowercase v4 uuid", () => {
    expect(folderIdSchema.parse(V4)).toBe(V4);
  });

  it("normalizes an uppercase v4 uuid to lowercase", () => {
    expect(folderIdSchema.parse(V4_UPPER)).toBe(V4);
  });

  it("rejects a non-v4 uuid", () => {
    expect(folderIdSchema.safeParse(V1).success).toBe(false);
  });

  it("rejects empty strings and non-strings", () => {
    expect(folderIdSchema.safeParse("").success).toBe(false);
    expect(folderIdSchema.safeParse(42).success).toBe(false);
    expect(folderIdSchema.safeParse(null).success).toBe(false);
  });
});

describe("isoDateSchema", () => {
  it("accepts a UTC instant with milliseconds", () => {
    expect(isoDateSchema.parse("2026-11-12T00:00:00.000Z")).toBe(
      "2026-11-12T00:00:00.000Z"
    );
  });

  it("accepts a UTC instant without milliseconds", () => {
    expect(isoDateSchema.safeParse("2026-11-12T00:00:00Z").success).toBe(true);
  });

  it("rejects a numeric offset", () => {
    expect(isoDateSchema.safeParse("2026-11-12T07:00:00+07:00").success).toBe(false);
  });

  it("rejects a date without a time", () => {
    expect(isoDateSchema.safeParse("2026-11-12").success).toBe(false);
  });

  it("rejects a lowercase z suffix", () => {
    expect(isoDateSchema.safeParse("2026-11-12T00:00:00z").success).toBe(false);
  });

  it("rejects a non-string", () => {
    expect(isoDateSchema.safeParse(Date.now()).success).toBe(false);
  });
});

describe("blobKeySchema", () => {
  it("accepts a lowercase v4 uuid", () => {
    expect(blobKeySchema.parse(V4)).toBe(V4);
  });

  it("rejects an uppercase v4 uuid, matching assertSafeBlobKey", () => {
    expect(blobKeySchema.safeParse(V4_UPPER).success).toBe(false);
  });

  it.each(["..", "../etc", "a/b", "a\\b", "", V1])("rejects %j", (value) => {
    expect(blobKeySchema.safeParse(value).success).toBe(false);
  });
});

describe("checksumSchema", () => {
  it("accepts null", () => {
    expect(checksumSchema.parse(null)).toBeNull();
  });

  it("accepts a lowercase digest", () => {
    expect(checksumSchema.parse(HEX)).toBe(HEX);
  });

  it("normalizes an uppercase digest, matching validateChecksum", () => {
    expect(checksumSchema.parse(HEX.toUpperCase())).toBe(HEX);
  });

  it("rejects a digest of the wrong length", () => {
    expect(checksumSchema.safeParse("a".repeat(63)).success).toBe(false);
    expect(checksumSchema.safeParse("a".repeat(65)).success).toBe(false);
  });

  it("rejects non-hex characters and the empty string", () => {
    expect(checksumSchema.safeParse("g".repeat(64)).success).toBe(false);
    expect(checksumSchema.safeParse("").success).toBe(false);
  });
});

describe("mimeTypeSchema", () => {
  it("accepts every allowlisted type", () => {
    for (const mimeType of [
      "application/pdf",
      "text/plain",
      "text/markdown",
      "image/png",
      "image/jpeg",
      "image/webp",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ]) {
      expect(mimeTypeSchema.parse(mimeType)).toBe(mimeType);
    }
  });

  it("rejects a type outside the allowlist", () => {
    expect(mimeTypeSchema.safeParse("application/zip").success).toBe(false);
    expect(mimeTypeSchema.safeParse("image/gif").success).toBe(false);
  });
});

describe("sizeBytesSchema", () => {
  it("accepts zero and exactly 25 MiB", () => {
    expect(sizeBytesSchema.parse(0)).toBe(0);
    expect(sizeBytesSchema.parse(26_214_400)).toBe(26_214_400);
  });

  it("rejects one byte over 25 MiB", () => {
    expect(sizeBytesSchema.safeParse(26_214_401).success).toBe(false);
  });

  it("rejects negatives, fractions, and non-finite numbers", () => {
    expect(sizeBytesSchema.safeParse(-1).success).toBe(false);
    expect(sizeBytesSchema.safeParse(1.5).success).toBe(false);
    expect(sizeBytesSchema.safeParse(Number.NaN).success).toBe(false);
    expect(sizeBytesSchema.safeParse(Number.POSITIVE_INFINITY).success).toBe(false);
  });

  it("rejects a numeric string", () => {
    expect(sizeBytesSchema.safeParse("1024").success).toBe(false);
  });
});

describe("displayNameSchema", () => {
  it("trims surrounding whitespace", () => {
    expect(displayNameSchema.parse("  Kerja  ")).toBe("Kerja");
  });

  it("accepts exactly 255 characters after trimming", () => {
    expect(displayNameSchema.parse(`  ${"a".repeat(255)}  `)).toHaveLength(255);
  });

  it("rejects 256 characters", () => {
    expect(displayNameSchema.safeParse("a".repeat(256)).success).toBe(false);
  });

  it.each(["", "   ", "/", "a/b", "a\\b", ".", "..", ".hidden", "trailing."])(
    "rejects %j",
    (value) => {
      expect(displayNameSchema.safeParse(value).success).toBe(false);
    }
  );

  it("rejects a control character", () => {
    expect(displayNameSchema.safeParse("a\u0000b").success).toBe(false);
    expect(displayNameSchema.safeParse("a\u001fb").success).toBe(false);
  });

  it("accepts ordinary Indonesian names", () => {
    expect(displayNameSchema.parse("Laporan Bulanan 2026")).toBe("Laporan Bulanan 2026");
  });
});

describe("tagNameSchema", () => {
  it("trims and accepts exactly 50 characters", () => {
    expect(tagNameSchema.parse("  penting  ")).toBe("penting");
    expect(tagNameSchema.parse("a".repeat(50))).toHaveLength(50);
  });

  it("rejects 51 characters", () => {
    expect(tagNameSchema.safeParse("a".repeat(51)).success).toBe(false);
  });

  it("rejects empty and whitespace-only names", () => {
    expect(tagNameSchema.safeParse("").success).toBe(false);
    expect(tagNameSchema.safeParse("   ").success).toBe(false);
  });
});

describe("tagColorSchema", () => {
  it("accepts null", () => {
    expect(tagColorSchema.parse(null)).toBeNull();
  });

  it("accepts six-digit hex and normalizes case", () => {
    expect(tagColorSchema.parse("#aabbcc")).toBe("#aabbcc");
    expect(tagColorSchema.parse("#AABBCC")).toBe("#aabbcc");
  });

  it.each(["#abc", "#gggggg", "aabbcc", "#aabbccdd", "rgb(0,0,0)"])(
    "rejects %j",
    (value) => {
      expect(tagColorSchema.safeParse(value).success).toBe(false);
    }
  );
});

describe("noteTitleSchema", () => {
  it("trims, accepts 1 character and exactly 200", () => {
    expect(noteTitleSchema.parse("  Ide  ")).toBe("Ide");
    expect(noteTitleSchema.parse("a")).toHaveLength(1);
    expect(noteTitleSchema.parse("a".repeat(200))).toHaveLength(200);
  });

  it("rejects 201 characters", () => {
    expect(noteTitleSchema.safeParse("a".repeat(201)).success).toBe(false);
  });

  it("rejects empty and whitespace-only titles", () => {
    expect(noteTitleSchema.safeParse("").success).toBe(false);
    expect(noteTitleSchema.safeParse("   ").success).toBe(false);
  });
});

describe("noteContentSchema", () => {
  it("accepts empty content and exactly 1,000,000 characters", () => {
    expect(noteContentSchema.parse("")).toBe("");
    expect(noteContentSchema.parse("a".repeat(1_000_000))).toHaveLength(1_000_000);
  });

  it("rejects 1,000,001 characters", () => {
    expect(noteContentSchema.safeParse("a".repeat(1_000_001)).success).toBe(false);
  });
});

describe("pageLimitSchema", () => {
  it("accepts 1 and exactly 500", () => {
    expect(pageLimitSchema.parse(1)).toBe(1);
    expect(pageLimitSchema.parse(500)).toBe(500);
  });

  it.each([0, -1, 501, 1.5])("rejects %d", (value) => {
    expect(pageLimitSchema.safeParse(value).success).toBe(false);
  });
});

describe("searchTextSchema", () => {
  it("accepts an empty string because empty searches return no hits", () => {
    expect(searchTextSchema.parse("")).toBe("");
  });

  it("accepts exactly 1,000 characters", () => {
    expect(searchTextSchema.parse("a".repeat(1_000))).toHaveLength(1_000);
  });

  it("rejects 1,001 characters", () => {
    expect(searchTextSchema.safeParse("a".repeat(1_001)).success).toBe(false);
  });
});

describe("domainCode", () => {
  it("tags every issue with the validation domain code", () => {
    const cases = [
      [folderIdSchema, "nope"],
      [isoDateSchema, "nope"],
      [blobKeySchema, "nope"],
      [checksumSchema, "nope"],
      [mimeTypeSchema, "nope"],
      [sizeBytesSchema, -1],
      [displayNameSchema, ""],
      [tagNameSchema, ""],
      [tagColorSchema, "nope"],
      [noteTitleSchema, ""],
      [noteContentSchema, 42],
      [pageLimitSchema, 0],
      [searchTextSchema, 42],
    ] as const;

    for (const [schema, value] of cases) {
      expect(firstIssue(schema, value)?.params).toMatchObject({
        domainCode: "validation",
      });
    }
  });
});
