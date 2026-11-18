import { describe, expect, it } from "vitest";

import nextConfig from "../next.config";

function connectSources(csp: string): string[] | undefined {
  const directive = csp
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("connect-src "));

  return directive?.split(/\s+/);
}

describe("Next.js security headers", () => {
  it("allows HTTPS and loopback AI endpoints without broad HTTP", async () => {
    const headerGroups = await nextConfig.headers?.();
    const csp = headerGroups
      ?.flatMap((group) => group.headers)
      .find((header) => header.key === "Content-Security-Policy")?.value;

    expect(csp).toBeDefined();

    const tokens = connectSources(csp ?? "");

    expect(tokens).toContain("https:");
    expect(tokens).toContain("http://localhost:*");
    expect(tokens).toContain("http://127.0.0.1:*");
    expect(tokens).not.toContain("http://[::1]:*");
    expect(tokens).not.toContain("http:");
  });
});
