import { describe, expect, it } from "vitest";

import { isTrustedShellMessage } from "../frame";

describe("extension frame guard", () => {
  it("accepts only the expected opaque iframe window", () => {
    const iframeWindow = {} as Window;
    const otherWindow = {} as Window;

    expect(
      isTrustedShellMessage({
        source: iframeWindow,
        origin: "null",
        expectedSource: iframeWindow,
      })
    ).toBe(true);
    expect(
      isTrustedShellMessage({
        source: otherWindow,
        origin: "null",
        expectedSource: iframeWindow,
      })
    ).toBe(false);
    expect(
      isTrustedShellMessage({
        source: iframeWindow,
        origin: "https://evil.test",
        expectedSource: iframeWindow,
      })
    ).toBe(false);
    expect(
      isTrustedShellMessage({
        source: null,
        origin: "null",
        expectedSource: iframeWindow,
      })
    ).toBe(false);
    expect(
      isTrustedShellMessage({
        source: iframeWindow,
        origin: "null",
        expectedSource: null,
      })
    ).toBe(false);
  });
});
