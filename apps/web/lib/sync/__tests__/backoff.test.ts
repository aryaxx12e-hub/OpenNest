import { describe, expect, it } from "vitest";

import { nextRetryDelay } from "../backoff";

describe("nextRetryDelay", () => {
  it("grows exponentially and caps at the maximum", () => {
    const options = {
      baseMs: 1000,
      maxMs: 5000,
      jitterRatio: 0,
      random: () => 0.5,
    };

    expect(nextRetryDelay(0, options)).toBe(1000);
    expect(nextRetryDelay(1, options)).toBe(2000);
    expect(nextRetryDelay(2, options)).toBe(4000);
    expect(nextRetryDelay(3, options)).toBe(5000);
    expect(nextRetryDelay(1000, options)).toBe(5000);
  });

  it("applies bounded jitter without dropping below the base delay", () => {
    const low = nextRetryDelay(1, {
      baseMs: 1000,
      maxMs: 30_000,
      jitterRatio: 0.25,
      random: () => 0,
    });
    const high = nextRetryDelay(1, {
      baseMs: 1000,
      maxMs: 30_000,
      jitterRatio: 0.25,
      random: () => 1,
    });

    expect(low).toBe(1500);
    expect(high).toBe(2500);
  });

  it("never returns a negative or non-finite delay", () => {
    for (let attempt = -2; attempt < 40; attempt += 1) {
      const delay = nextRetryDelay(attempt, {
        baseMs: 500,
        maxMs: 10_000,
        jitterRatio: 1,
        random: () => 1,
      });

      expect(Number.isFinite(delay)).toBe(true);
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThanOrEqual(10_000);
    }
  });
});
