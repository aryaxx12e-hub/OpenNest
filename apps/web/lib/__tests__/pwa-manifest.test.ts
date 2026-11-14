import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import manifest from "@/app/manifest";

const WEB_DIR = path.join(process.cwd(), "apps/web");

describe("PWA manifest", () => {
  it("describes an installable OpenNest app", () => {
    const data = manifest();

    expect(data.name).toBe("OpenNest");
    expect(data.short_name).toBe("OpenNest");
    expect(data.start_url).toBe("/");
    expect(data.scope).toBe("/");
    expect(data.display).toBe("standalone");
    expect(data.background_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(data.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("ships PNG icons with the dimensions it declares", () => {
    const icons = manifest().icons ?? [];
    const pngIcons = icons.filter((icon) => icon.type === "image/png");

    expect(pngIcons.some((icon) => icon.sizes === "192x192")).toBe(true);
    expect(pngIcons.some((icon) => icon.sizes === "512x512")).toBe(true);
    expect(pngIcons.some((icon) => icon.purpose === "maskable")).toBe(true);

    for (const icon of pngIcons) {
      const file = path.join(WEB_DIR, "public", icon.src.replace(/^\//, ""));

      expect(existsSync(file), `${icon.src} should exist`).toBe(true);

      const bytes = readFileSync(file);

      expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);

      const width = bytes.readUInt32BE(16);
      const height = bytes.readUInt32BE(20);

      expect(`${width}x${height}`).toBe(icon.sizes);
    }
  });
});
