import { describe, expect, it } from "vitest";

import type { FileFilter, NoteFilter, SearchQuery } from "@opennest/core";

import { fileFilterSchema, noteFilterSchema } from "../filter";
import { searchQuerySchema } from "../search";

const WS = "11111111-1111-4111-8111-111111111111";
const FOLDER = "22222222-2222-4222-8222-222222222222";
const TAG = "33333333-3333-4333-8333-333333333333";

describe("fileFilterSchema", () => {
  it("accepts an empty filter as no filtering at all", () => {
    const filter: FileFilter = fileFilterSchema.parse({});

    expect(filter).toEqual({});
  });

  it("keeps an explicit null folderId, distinct from omitting it", () => {
    expect(fileFilterSchema.parse({ folderId: null })).toEqual({ folderId: null });
    expect(fileFilterSchema.parse({})).toEqual({});
  });

  it("accepts a folder id and tag ids", () => {
    expect(fileFilterSchema.parse({ folderId: FOLDER, tagIds: [TAG] })).toEqual({
      folderId: FOLDER,
      tagIds: [TAG],
    });
  });

  it("accepts allowlisted MIME types", () => {
    expect(fileFilterSchema.parse({ mimeTypes: ["image/png"] })).toEqual({
      mimeTypes: ["image/png"],
    });
  });

  it("rejects a MIME type outside the allowlist", () => {
    expect(fileFilterSchema.safeParse({ mimeTypes: ["image/gif"] }).success).toBe(false);
  });

  it("accepts a text filter", () => {
    expect(fileFilterSchema.parse({ text: "laporan" })).toEqual({ text: "laporan" });
  });

  it("rejects text over the search bound", () => {
    expect(fileFilterSchema.safeParse({ text: "a".repeat(1_001) }).success).toBe(false);
  });

  it("rejects an unknown key", () => {
    expect(fileFilterSchema.safeParse({ pinned: true }).success).toBe(false);
  });

  it("rejects a tag id that is not a uuid", () => {
    expect(fileFilterSchema.safeParse({ tagIds: ["nope"] }).success).toBe(false);
  });
});

describe("noteFilterSchema", () => {
  it("accepts an empty filter", () => {
    const filter: NoteFilter = noteFilterSchema.parse({});

    expect(filter).toEqual({});
  });

  it("accepts pinned true and false without dropping false", () => {
    expect(noteFilterSchema.parse({ pinned: true })).toEqual({ pinned: true });
    expect(noteFilterSchema.parse({ pinned: false })).toEqual({ pinned: false });
  });

  it("rejects a non-boolean pinned", () => {
    expect(noteFilterSchema.safeParse({ pinned: "yes" }).success).toBe(false);
  });

  it("rejects an unknown key", () => {
    expect(noteFilterSchema.safeParse({ mimeTypes: ["image/png"] }).success).toBe(false);
  });
});

describe("searchQuerySchema", () => {
  it("accepts a minimal query", () => {
    const query: SearchQuery = searchQuerySchema.parse({
      workspaceId: WS,
      text: "laporan",
    });

    expect(query).toEqual({ workspaceId: WS, text: "laporan" });
  });

  it("accepts an empty text because empty searches return no hits", () => {
    expect(searchQuerySchema.parse({ workspaceId: WS, text: "" })).toMatchObject({
      text: "",
    });
  });

  it("accepts kinds, folder, tags, limit, and offset", () => {
    expect(
      searchQuerySchema.parse({
        workspaceId: WS,
        text: "laporan",
        kinds: ["file", "note"],
        folderId: FOLDER,
        tagIds: [TAG],
        limit: 500,
        offset: 0,
      })
    ).toMatchObject({ limit: 500, offset: 0, kinds: ["file", "note"] });
  });

  it("rejects an unknown kind", () => {
    expect(
      searchQuerySchema.safeParse({ workspaceId: WS, text: "a", kinds: ["folder"] })
        .success
    ).toBe(false);
  });

  it("rejects duplicate kinds", () => {
    expect(
      searchQuerySchema.safeParse({ workspaceId: WS, text: "a", kinds: ["file", "file"] })
        .success
    ).toBe(false);
  });

  it("rejects an empty kinds array", () => {
    expect(
      searchQuerySchema.safeParse({ workspaceId: WS, text: "a", kinds: [] }).success
    ).toBe(false);
  });

  it("rejects limit 0 and 501", () => {
    expect(
      searchQuerySchema.safeParse({ workspaceId: WS, text: "a", limit: 0 }).success
    ).toBe(false);
    expect(
      searchQuerySchema.safeParse({ workspaceId: WS, text: "a", limit: 501 }).success
    ).toBe(false);
  });

  it("rejects a negative offset and a fractional offset", () => {
    expect(
      searchQuerySchema.safeParse({ workspaceId: WS, text: "a", offset: -1 }).success
    ).toBe(false);
    expect(
      searchQuerySchema.safeParse({ workspaceId: WS, text: "a", offset: 1.5 }).success
    ).toBe(false);
  });

  it("rejects text over the search bound", () => {
    expect(
      searchQuerySchema.safeParse({ workspaceId: WS, text: "a".repeat(1_001) }).success
    ).toBe(false);
  });

  it("rejects an unknown key", () => {
    expect(
      searchQuerySchema.safeParse({ workspaceId: WS, text: "a", sort: "name" }).success
    ).toBe(false);
  });
});
