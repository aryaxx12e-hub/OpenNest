import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const config = [
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/.next-static/**",
      "**/out/**",
      "**/android/**",
      "**/coverage/**",
      "**/dist/**",
      "**/playwright-report/**",
      "**/test-results/**",
      "next-env.d.ts",
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      "@next/next/no-html-link-for-pages": "off",
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@opennest/*/src/*", "@opennest/*/*"],
              message:
                "Import workspace packages through their public entry point, not internals.",
            },
          ],
        },
      ],
    },
  },
];

export default config;
