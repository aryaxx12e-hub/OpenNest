// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  createCsrfChallenge,
  verifyCsrf,
} from "../csrf";

describe("csrf", () => {
  it("creates a 32-byte token and its hash", () => {
    const challenge = createCsrfChallenge();

    expect(Buffer.from(challenge.token, "base64url")).toHaveLength(32);
    expect(challenge.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(challenge.hash).not.toBe(challenge.token);
  });

  it("accepts a matching header, cookie, and session hash", () => {
    const challenge = createCsrfChallenge();

    expect(
      verifyCsrf({
        headerToken: challenge.token,
        cookieToken: challenge.token,
        sessionHash: challenge.hash,
      })
    ).toBe(true);
  });

  it("rejects a missing, mismatched, or foreign token", () => {
    const challenge = createCsrfChallenge();
    const other = createCsrfChallenge();

    expect(
      verifyCsrf({
        headerToken: undefined,
        cookieToken: challenge.token,
        sessionHash: challenge.hash,
      })
    ).toBe(false);
    expect(
      verifyCsrf({
        headerToken: challenge.token,
        cookieToken: other.token,
        sessionHash: challenge.hash,
      })
    ).toBe(false);
    expect(
      verifyCsrf({
        headerToken: challenge.token,
        cookieToken: challenge.token,
        sessionHash: other.hash,
      })
    ).toBe(false);
  });

  it("names the cookie and header used by the server", () => {
    expect(CSRF_COOKIE_NAME).toBe("opennest_csrf");
    expect(CSRF_HEADER_NAME).toBe("x-csrf-token");
  });
});
