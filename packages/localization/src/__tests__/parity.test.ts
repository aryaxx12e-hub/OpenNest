import { describe, expect, it } from "vitest";

import { en } from "../en";
import { formatDate, formatNumber, formatRelativeTime } from "../format";
import { id } from "../id";
import { defaultLocale, locales, translate } from "../provider";

function collectPaths(value: unknown, prefix = ""): string[] {
  if (typeof value === "string") {
    return [prefix];
  }
  if (typeof value !== "object" || value === null) {
    return [];
  }

  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    collectPaths(child, prefix === "" ? key : `${prefix}.${key}`)
  );
}

describe("catalogs", () => {
  it("has the same key paths in every locale", () => {
    const enPaths = collectPaths(en).sort();
    const idPaths = collectPaths(id).sort();

    expect(idPaths).toEqual(enPaths);
  });

  it("has no empty strings", () => {
    for (const locale of locales) {
      for (const path of collectPaths(en)) {
        expect(translate(locale, path).trim()).not.toBe("");
      }
    }
  });

  it("translates a known key in both locales", () => {
    expect(translate("en", "nav.home")).toBe("Home");
    expect(translate("id", "nav.home")).toBe("Beranda");
  });

  it("throws for an unknown key in the test environment", () => {
    expect(() => translate("en", "does.not.exist")).toThrow(/Unknown translation key/);
  });

  it("falls back to English as the default locale", () => {
    expect(defaultLocale).toBe("en");
  });
});

describe("Intl formatting", () => {
  it("formats numbers per locale", () => {
    expect(formatNumber("en", 1234.5)).toBe("1,234.5");
    expect(formatNumber("id", 1234.5)).toBe("1.234,5");
  });

  it("formats dates per locale", () => {
    const date = new Date(Date.UTC(2026, 0, 15, 12));
    expect(formatDate("en", date, { dateStyle: "long" })).toContain("January");
    expect(formatDate("id", date, { dateStyle: "long" })).toContain("Januari");
  });

  it("formats relative time per locale", () => {
    expect(formatRelativeTime("en", -5, "day")).toBe("5 days ago");
    expect(formatRelativeTime("id", -5, "day")).toBe("5 hari yang lalu");
  });
});
