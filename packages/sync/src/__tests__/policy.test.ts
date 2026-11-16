import { describe, expect, it } from "vitest";

import {
  DEFAULT_SYNC_POLICY,
  MERGE_SAFE_FIELDS,
  canonicalIdList,
  fieldClass,
} from "../index";

describe("sync policy", () => {
  it("keeps the outbox disabled and bounded", () => {
    expect(DEFAULT_SYNC_POLICY.outbox).toEqual({
      enabled: false,
      maxRows: 1000,
      retentionMs: 30 * 24 * 60 * 60 * 1000,
    });
  });

  it("pins the merge-safe field list", () => {
    expect([...MERGE_SAFE_FIELDS]).toEqual(["note.pinned", "tag.color"]);
  });

  it("classifies every other field as content-bearing", () => {
    expect(fieldClass("note", "pinned")).toBe("merge-safe");
    expect(fieldClass("tag", "color")).toBe("merge-safe");
    expect(fieldClass("note", "content")).toBe("content-bearing");
    expect(fieldClass("file", "name")).toBe("content-bearing");
  });

  it("canonicalizes relation ID arrays", () => {
    expect(canonicalIdList(["b", "a", "b"])).toEqual(["a", "b"]);
    expect(canonicalIdList(["a", "b"])).toEqual(canonicalIdList(["b", "a"]));
  });
});
