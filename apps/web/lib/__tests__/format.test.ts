import { describe, expect, it } from "vitest";

import { formatBytes } from "../format";

describe("formatBytes", () => {
  it("formats bytes, kilobytes, megabytes, and gigabytes", () => {
    expect(formatBytes("en", 0)).toBe("0 B");
    expect(formatBytes("en", 1536)).toBe("1.5 KB");
    expect(formatBytes("en", 12 * 1024)).toBe("12 KB");
    expect(formatBytes("en", 5 * 1024 * 1024)).toBe("5 MB");
    expect(formatBytes("en", 3 * 1024 * 1024 * 1024)).toBe("3 GB");
  });

  it("uses the Indonesian decimal separator", () => {
    expect(formatBytes("id", 1536)).toBe("1,5 KB");
  });
});
