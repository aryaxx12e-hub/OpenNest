import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createVersion, renderServiceWorker, uniquePaths } from "./build-lib.mjs";

const TEMPLATE_URL = path.join(process.cwd(), "scripts/pwa/service-worker.js");

describe("service worker generation", () => {
  it("injects a version and a deduplicated precache list", async () => {
    const template = await readFile(TEMPLATE_URL, "utf8");
    const source = renderServiceWorker({
      template,
      version: "abc123",
      precache: ["/", "/offline", "/", "/icons/icon-192.png"],
    });

    expect(source).toContain('"abc123"');
    expect(source).toContain('"/offline"');
    expect(source).not.toContain("__PWA_VERSION__");
    expect(source).not.toContain("__PWA_PRECACHE__");
    expect(source).toContain("SKIP_WAITING");
    expect(source).toContain('request.mode === "navigate"');
  });

  it("changes the version when inputs change", () => {
    const first = createVersion(["a", "b"]);
    const second = createVersion(["a", "c"]);

    expect(first).toHaveLength(16);
    expect(first).not.toBe(second);
  });

  it("sorts and deduplicates precache paths", () => {
    expect(uniquePaths(["/b", "/a", "/b", "/"])).toEqual(["/", "/a", "/b"]);
  });
});
