import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // sql.js loads its WebAssembly file from node_modules at runtime, so it must not be bundled.
  serverExternalPackages: ["sql.js"],
  // Keep the dev-mode badge away from the sidebar's controls (bottom-left).
  devIndicators: { position: "bottom-right" },
  // Keep `next build` light enough for laptops with little free memory:
  // type checking runs separately (`npm run typecheck`), and server source
  // maps are skipped. Together this cuts the build's peak memory by ~15%.
  typescript: { ignoreBuildErrors: true },
  experimental: { serverSourceMaps: false, cpus: 1 },
  enablePrerenderSourceMaps: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
