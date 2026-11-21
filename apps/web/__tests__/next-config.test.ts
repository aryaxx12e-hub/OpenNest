import { describe, expect, it } from "vitest";

import nextConfig, { createNextConfig } from "../next.config";

function directive(csp: string, name: string): string[] | undefined {
  const line = csp
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name} `));

  return line?.split(/\s+/);
}

function connectSources(csp: string): string[] | undefined {
  return directive(csp, "connect-src");
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

  it("allows only the local extension frame and forbids embedding", async () => {
    const headerGroups = await nextConfig.headers?.();
    const csp = headerGroups
      ?.flatMap((group) => group.headers)
      .find((header) => header.key === "Content-Security-Policy")?.value;

    expect(csp).toBeDefined();
    expect(csp).toContain("frame-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(directive(csp ?? "", "frame-src")).toEqual(["frame-src", "'self'"]);
  });

  it("lets the opaque extension frame load its shell asset", async () => {
    const headerGroups = await nextConfig.headers?.();
    const sandbox = headerGroups?.find(
      (group) => group.source === "/extension-sandbox.js"
    );

    expect(sandbox?.headers).toContainEqual({
      key: "Cross-Origin-Resource-Policy",
      value: "cross-origin",
    });
  });

  it("transpiles the extension package for the browser", () => {
    expect(nextConfig.transpilePackages).toContain("@opennest/extensions");
  });

  it("keeps the server build dynamic with security headers", () => {
    const config = createNextConfig(false);

    expect(config.output).toBeUndefined();
    expect(config.distDir).toBeUndefined();
    expect(typeof config.headers).toBe("function");
  });

  it("creates a static export without server-only headers", () => {
    const config = createNextConfig(true);

    expect(config.output).toBe("export");
    expect(config.distDir).toBe("out");
    expect(config.trailingSlash).toBe(false);
    expect(config.images).toEqual({ unoptimized: true });
    expect(config.headers).toBeUndefined();
    expect(config.transpilePackages).toContain("@opennest/extensions");
  });
});
