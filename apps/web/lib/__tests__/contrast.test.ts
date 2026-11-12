import { describe, expect, it } from "vitest";

import { contrastRatio, relativeLuminance } from "../contrast";
import { contrastPairs, tokens, type ThemeName } from "../tokens";

const themes: ThemeName[] = ["light", "dark"];

describe("contrast tokens", () => {
  it("computes known contrast ratios", () => {
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 5);
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 5);
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
  });

  it("rejects malformed colours", () => {
    expect(() => relativeLuminance("#fff")).toThrow(/6-digit hex/);
    expect(() => relativeLuminance("rebeccapurple")).toThrow(/6-digit hex/);
  });

  for (const theme of themes) {
    describe(`${theme} theme`, () => {
      for (const pair of contrastPairs) {
        it(`${pair.label} meets ${pair.min}:1`, () => {
          const ratio = contrastRatio(
            tokens[theme][pair.foreground],
            tokens[theme][pair.background]
          );

          expect(
            ratio,
            `${pair.label} measured ${ratio.toFixed(2)}:1`
          ).toBeGreaterThanOrEqual(pair.min);
        });
      }
    });
  }
});
