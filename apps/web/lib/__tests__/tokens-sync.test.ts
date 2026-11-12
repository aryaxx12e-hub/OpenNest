import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { tokens } from "../tokens";

const cssPath = path.resolve(process.cwd(), "apps/web/app/globals.css");
const css = readFileSync(cssPath, "utf8").toLowerCase();

describe("token parity with stylesheet", () => {
  for (const [theme, values] of Object.entries(tokens)) {
    it(`defines every ${theme} token value in globals.css`, () => {
      for (const [name, value] of Object.entries(values)) {
        expect(css, `${theme}.${name} = ${value} is missing from globals.css`).toContain(
          value.toLowerCase()
        );
      }
    });
  }

  it("names each token as a CSS custom property", () => {
    for (const name of Object.keys(tokens.light)) {
      const property = name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
      expect(css).toContain(`--${property}:`);
    }
  });
});
