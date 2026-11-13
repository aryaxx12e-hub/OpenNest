import { readFileSync } from "node:fs";

import { describe, expect, expectTypeOf, it } from "vitest";

import type { BackupSnapshot, FileFilter, NoteFilter, SearchQuery } from "@opennest/core";
import { validateChecksum, validateDisplayName } from "@opennest/core";
import * as validation from "../index";
import type {
  FileInput,
  FilePatch,
  FolderInput,
  FolderPatch,
  NoteInput,
  NotePatch,
  TagInput,
  TagPatch,
} from "../index";

const WS = "11111111-1111-4111-8111-111111111111";
const FOLDER = "22222222-2222-4222-8222-222222222222";
const BLOB = "44444444-4444-4444-8444-444444444444";

describe("type contracts", () => {
  it("types the filter schemas as the core port types", () => {
    expectTypeOf(validation.fileFilterSchema).toMatchTypeOf<
      import("zod").ZodType<FileFilter>
    >();
    expectTypeOf(validation.noteFilterSchema).toMatchTypeOf<
      import("zod").ZodType<NoteFilter>
    >();
    expectTypeOf(validation.searchQuerySchema).toMatchTypeOf<
      import("zod").ZodType<SearchQuery>
    >();
    expectTypeOf(validation.backupSnapshotSchema).toMatchTypeOf<
      import("zod").ZodType<BackupSnapshot>
    >();
  });

  it("infers inputs that the core services accept", () => {
    const folder = validation.folderInputSchema.parse({
      workspaceId: WS,
      parentId: null,
      name: "Kerja",
    });
    const file = validation.fileInputSchema.parse({
      workspaceId: WS,
      folderId: null,
      name: "a.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1,
      blobKey: BLOB,
      checksum: null,
    });
    const note = validation.noteInputSchema.parse({
      workspaceId: WS,
      folderId: FOLDER,
      title: "Ide",
    });
    const tag = validation.tagInputSchema.parse({ workspaceId: WS, name: "Penting" });

    expectTypeOf(folder).toEqualTypeOf<FolderInput>();
    expectTypeOf(file).toEqualTypeOf<FileInput>();
    expectTypeOf(note).toEqualTypeOf<NoteInput>();
    expectTypeOf(tag).toEqualTypeOf<TagInput>();

    const parsedFilters: FileFilter = validation.fileFilterSchema.parse({
      folderId: null,
    });
    const parsedNoteFilters: NoteFilter = validation.noteFilterSchema.parse({
      pinned: false,
    });
    const parsedSearch: SearchQuery = validation.searchQuerySchema.parse({
      workspaceId: WS,
      text: "x",
    });

    void parsedFilters;
    void parsedNoteFilters;
    void parsedSearch;
  });

  it("infers patches that keep undefined meaning unchanged", () => {
    expectTypeOf(
      validation.filePatchSchema.parse({ name: "a.pdf" })
    ).toEqualTypeOf<FilePatch>();
    expectTypeOf(
      validation.folderPatchSchema.parse({ name: "a" })
    ).toEqualTypeOf<FolderPatch>();
    expectTypeOf(
      validation.notePatchSchema.parse({ title: "a" })
    ).toEqualTypeOf<NotePatch>();
    expectTypeOf(
      validation.tagPatchSchema.parse({ name: "a" })
    ).toEqualTypeOf<TagPatch>();
  });

  it("never exports a narrow filter type that drops a port field", () => {
    const filter: FileFilter = {};
    const parsed = validation.fileFilterSchema.parse(filter);

    expect(Object.keys(parsed)).toEqual([]);
  });
});

describe("dependency direction", () => {
  const source = readFileSync("packages/validation/src/filter.ts", "utf8");

  it("imports limits from core instead of duplicating a number", () => {
    expect(source).not.toMatch(/26_214_400|1_000_000|maxNameLength\s*=/);
  });

  it("never imports an adapter or app code", () => {
    expect(source).not.toMatch(/@opennest\/(storage|ui|web)/);
    expect(source).not.toMatch(/\bnode:/);
  });
});

describe("purity", () => {
  it("does not mutate the input it parses", () => {
    const input = {
      workspaceId: WS,
      folderId: null,
      name: "  Laporan  ",
      mimeType: "application/pdf",
      sizeBytes: 1,
      blobKey: "3f2b8c1e-9d4a-4f6b-8c2d-1a2b3c4d5e6f",
      checksum: "A".repeat(64),
    };
    const copy = structuredClone(input);

    validation.fileInputSchema.parse(input);

    expect(input).toEqual(copy);
  });

  it("returns a new object, not the caller's reference", () => {
    const filter = { folderId: null };
    const parsed = validation.fileFilterSchema.parse(filter);

    expect(parsed).not.toBe(filter);
  });
});

describe("cross-check against core rules", () => {
  const names = [
    "Kerja",
    "  Arsip  ",
    "a".repeat(255),
    "a".repeat(256),
    "a/b",
    "a\\b",
    ".",
    "..",
    ".hidden",
    "trailing.",
    "a\u0000b",
    "",
    "   ",
  ];

  it.each(names)(
    "classifies display name %j the same way as validateDisplayName",
    (name) => {
      let expected = true;

      try {
        validateDisplayName(name);
      } catch {
        expected = false;
      }

      expect(validation.displayNameSchema.safeParse(name).success).toBe(expected);
    }
  );

  it("agrees with validateChecksum on every sampled digest", () => {
    const samples = [
      "a".repeat(64),
      "A".repeat(64),
      "0".repeat(64),
      "a".repeat(63),
      "a".repeat(65),
      "",
      "g".repeat(64),
      `${"f".repeat(63)}Z`,
      "ab".repeat(32),
    ];

    for (const sample of samples) {
      let expected: string | null | "reject" = "reject";

      try {
        expected = validateChecksum(sample);
      } catch {
        expected = "reject";
      }

      const parsed = validation.checksumSchema.safeParse(sample);

      if (expected === "reject") {
        expect(parsed.success).toBe(false);
      } else {
        expect(parsed.success).toBe(true);
        expect(parsed.success ? parsed.data : undefined).toBe(expected);
      }
    }
  });

  it("agrees with validateChecksum on case handling", () => {
    expect(validation.checksumSchema.parse("A".repeat(64))).toBe("a".repeat(64));
    expect(validation.checksumSchema.parse(null)).toBeNull();
  });

  it("agrees with assertSafeBlobKey on case", () => {
    const lower = "3f2b8c1e-9d4a-4f6b-8c2d-1a2b3c4d5e6f";

    expect(validation.blobKeySchema.safeParse(lower.toUpperCase()).success).toBe(false);
    expect(validation.blobKeySchema.safeParse(lower).success).toBe(true);
  });
});
