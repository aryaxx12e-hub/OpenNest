import { describe, expect, it } from "vitest";

import { decodeCursor, encodeCursor } from "../cursor";

describe("cursor encoding", () => {
  it("round-trips a sort value and id", () => {
    const cursor = encodeCursor(["laporan", "id-1"]);

    expect(decodeCursor(cursor)).toEqual(["laporan", "id-1"]);
  });

  it("produces a url-safe string with no padding", () => {
    const cursor = encodeCursor(["Kerja/Ünit + test", "id-2"]);

    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("is identical in both adapters because it is one encoding", () => {
    expect(encodeCursor(["a", "b"])).toBe(encodeCursor(["a", "b"]));
  });

  it("rejects a malformed cursor instead of paging from nowhere", () => {
    expect(() => decodeCursor("not-a-cursor!")).toThrow();
    expect(() => decodeCursor("")).toThrow();
    expect(() => decodeCursor(encodeCursor(["only-one"]))).toThrow();
  });

  it("keeps unicode sort values intact", () => {
    const cursor = encodeCursor(["café", "id-3"]);

    expect(decodeCursor(cursor)[0]).toBe("café");
  });
});
