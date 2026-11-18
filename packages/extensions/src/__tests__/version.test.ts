import { describe, expect, it } from "vitest";

import { compareVersions } from "../version";

describe("extension versions", () => {
  it("compares each numeric segment", () => {
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
    expect(compareVersions("1.2.3", "1.2.4")).toBe(-1);
    expect(compareVersions("1.2.4", "1.2.3")).toBe(1);
    expect(compareVersions("2.0.0", "1.9.9")).toBe(1);
    expect(compareVersions("1.10.0", "1.9.0")).toBe(1);
  });

  it("rejects malformed versions", () => {
    expect(() => compareVersions("1.0", "1.0.0")).toThrow("invalid_version");
    expect(() => compareVersions("v1.0.0", "1.0.0")).toThrow("invalid_version");
    expect(() => compareVersions("1.0.0-beta", "1.0.0")).toThrow("invalid_version");
  });
});
