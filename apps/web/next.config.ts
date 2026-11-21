import type { NextConfig } from "next";

import { buildContentSecurityPolicy } from "./lib/security/csp.mjs";

const isDevelopment = process.env.NODE_ENV !== "production";

const contentSecurityPolicy = buildContentSecurityPolicy({
  development: isDevelopment,
});

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "no-referrer" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
];

const sharedConfig = {
  reactStrictMode: true,
  transpilePackages: [
    "@opennest/ui",
    "@opennest/localization",
    "@opennest/core",
    "@opennest/validation",
    "@opennest/storage-dexie",
    "@opennest/sync",
    "@opennest/crypto",
    "@opennest/credential-vault",
    "@opennest/ai",
    "@opennest/extensions",
  ],
} satisfies NextConfig;

export function createNextConfig(staticExport: boolean): NextConfig {
  if (staticExport) {
    return {
      ...sharedConfig,
      output: "export",
      distDir: "out",
      trailingSlash: false,
      images: { unoptimized: true },
    };
  }

  return {
    ...sharedConfig,
    async headers() {
      return [
        {
          source: "/(.*)",
          headers: securityHeaders,
        },
        {
          source: "/extension-sandbox.js",
          headers: [
            {
              key: "Cross-Origin-Resource-Policy",
              value: "cross-origin",
            },
          ],
        },
        {
          source: "/sw.js",
          headers: [
            {
              key: "Cache-Control",
              value: "no-cache, no-store, must-revalidate",
            },
            {
              key: "Service-Worker-Allowed",
              value: "/",
            },
          ],
        },
      ];
    },
  };
}

const nextConfig = createNextConfig(process.env.OPENNEST_STATIC_EXPORT === "1");

export default nextConfig;
