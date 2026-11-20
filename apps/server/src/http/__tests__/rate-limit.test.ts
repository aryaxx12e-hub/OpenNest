// @vitest-environment node

import { describe, expect, it } from "vitest";

import { createRateLimiter } from "../rate-limit";

describe("rate limiter", () => {
  it("allows up to the limit, then reports when to retry", () => {
    let now = new Date("2026-11-18T10:00:00.000Z");
    const limiter = createRateLimiter({
      limit: 2,
      windowMs: 60_000,
      now: () => now,
    });

    expect(limiter.consume("client").allowed).toBe(true);
    expect(limiter.consume("client").allowed).toBe(true);

    const blocked = limiter.consume("client");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(60);

    now = new Date(now.getTime() + 60_000);
    expect(limiter.consume("client").allowed).toBe(true);
  });

  it("isolates clients and resets after a successful action", () => {
    let now = new Date("2026-11-18T10:00:00.000Z");
    const limiter = createRateLimiter({
      limit: 1,
      windowMs: 60_000,
      now: () => now,
    });

    expect(limiter.consume("first").allowed).toBe(true);
    expect(limiter.consume("first").allowed).toBe(false);
    expect(limiter.consume("second").allowed).toBe(true);

    limiter.reset("first");
    expect(limiter.consume("first").allowed).toBe(true);

    now = new Date(now.getTime() + 60_000);
    limiter.cleanup();
    expect(limiter.size()).toBe(0);
  });
});
