import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOT_DIR = process.cwd();

function read(relativePath: string): string {
  return readFileSync(path.join(ROOT_DIR, relativePath), "utf8");
}

describe("extension PWA assets", () => {
  it("precaches the extensions route and serves the sandbox shell", () => {
    const buildSource = read("scripts/pwa/build.mjs");
    const workerSource = read("scripts/pwa/service-worker.js");

    expect(buildSource).toContain('"/extensions"');
    expect(workerSource).toContain('url.pathname === "/extension-sandbox.js"');
    expect(existsSync(path.join(ROOT_DIR, "apps/web/public/extension-sandbox.js"))).toBe(
      true
    );
  });

  it("includes the extension package in the browser graph", () => {
    const graphSource = read("scripts/check-browser-graph.mjs");

    expect(graphSource).toContain("packages/extensions/src/index.ts");
    expect(graphSource).toContain('"packages/extensions"');
  });
});
