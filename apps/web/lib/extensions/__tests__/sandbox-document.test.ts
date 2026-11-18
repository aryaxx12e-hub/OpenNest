import { describe, expect, it } from "vitest";

import { buildExtensionSandboxDocument } from "../sandbox-document";

describe("extension sandbox document", () => {
  it("locks the document down and loads only the trusted shell script", () => {
    const html = buildExtensionSandboxDocument("https://app.test");

    expect(html).toContain("default-src 'none'");
    expect(html).toContain("script-src https://app.test");
    expect(html).toContain("worker-src blob:");
    expect(html).toContain("connect-src 'none'");
    expect(html).toContain("img-src 'none'");
    expect(html).toContain("style-src 'none'");
    expect(html).toContain("font-src 'none'");
    expect(html).toContain("media-src 'none'");
    expect(html).toContain("frame-src 'none'");
    expect(html).toContain("object-src 'none'");
    expect(html).toContain("base-uri 'none'");
    expect(html).toContain("form-action 'none'");
    expect(html).toContain("manifest-src 'none'");
    expect(html).toContain(
      '<script src="https://app.test/extension-sandbox.js"></script>'
    );
    expect(html).not.toContain("'unsafe-inline'");
    expect(html).not.toContain("'unsafe-eval'");
    expect(html).not.toContain('<script src="blob:');
    expect(html).not.toContain("script-src blob:");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<style");
  });

  it("normalizes an origin and rejects ambiguous or unsafe values", () => {
    expect(buildExtensionSandboxDocument("http://localhost:3000")).toContain(
      "script-src http://localhost:3000"
    );
    expect(() => buildExtensionSandboxDocument("https://app.test/")).toThrow();
    expect(() => buildExtensionSandboxDocument("javascript:alert(1)")).toThrow();
    expect(() => buildExtensionSandboxDocument("https://user:pass@app.test")).toThrow();
    expect(() => buildExtensionSandboxDocument("https://app.test?x=1")).toThrow();
  });
});
