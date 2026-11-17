import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: {
    jsx: "automatic",
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./apps/web", import.meta.url)),
    },
  },
  test: {
    environment: "happy-dom",
    testTimeout: 20_000,
    include: [
      "packages/**/*.test.{ts,tsx}",
      "apps/web/**/*.test.{ts,tsx}",
      "scripts/**/*.test.mjs",
    ],
    exclude: ["**/node_modules/**", "**/.next/**"],
  },
});
