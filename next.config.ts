import type { NextConfig } from "next";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveBuildInfo } from "./src/lib/build-info";

const build = resolveBuildInfo({
  version: JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")).version,
  vercelSha: process.env.VERCEL_GIT_COMMIT_SHA,
  gitSha: () => execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(),
  now: new Date(),
});

const nextConfig: NextConfig = {
  // Baked into server and client bundles; /api/version serves the same
  // values so an open page can tell when a newer build is live.
  env: {
    NEXT_PUBLIC_APP_VERSION: build.version,
    NEXT_PUBLIC_BUILD_SHA: build.sha,
    NEXT_PUBLIC_BUILT_AT: build.builtAt,
    NEXT_PUBLIC_BUILD_ID: build.buildId,
  },
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // geolocation=(self): the "You're at …?" chip asks for location on this
          // origin only (computed on the device, never sent). Third-party frames get none.
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
        ],
      },
    ];
  },
  turbopack: {
    rules: {
      "*.css": { loaders: ["@tailwindcss/turbopack"], as: "*.css" },
    },
  },
};

export default nextConfig;
