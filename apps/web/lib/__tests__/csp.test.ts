import { describe, expect, it } from "vitest";

import { AI_CONNECT_SOURCES, buildContentSecurityPolicy } from "../security/csp.mjs";

function directive(csp: string, name: string): string[] | undefined {
  const line = csp
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name} `));

  return line?.split(/\s+/);
}

describe("content security policy", () => {
  it("builds the production policy without development-only sources", () => {
    const csp = buildContentSecurityPolicy({ development: false });

    expect(directive(csp, "script-src")).toEqual([
      "script-src",
      "'self'",
      "'unsafe-inline'",
    ]);
    expect(csp).not.toContain("'unsafe-eval'");
    expect(directive(csp, "connect-src")).not.toContain("ws:");
    expect(csp).toContain(AI_CONNECT_SOURCES);
  });

  it("adds development evaluation and websocket sources", () => {
    const csp = buildContentSecurityPolicy({ development: true });

    expect(directive(csp, "script-src")).toContain("'unsafe-eval'");
    expect(directive(csp, "connect-src")).toContain("ws:");
    expect(directive(csp, "connect-src")).toContain("wss:");
  });

  it("keeps the local extension frame and opaque worker rules", () => {
    const csp = buildContentSecurityPolicy({ development: false });

    expect(directive(csp, "frame-src")).toEqual(["frame-src", "'self'"]);
    expect(directive(csp, "worker-src")).toEqual(["worker-src", "'self'", "blob:"]);
    expect(csp).toContain("frame-ancestors 'none'");
  });
});
