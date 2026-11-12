import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@opennest/ui", "@opennest/localization"],
};

export default nextConfig;
