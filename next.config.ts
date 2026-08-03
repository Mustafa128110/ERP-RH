import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Keeps Turbopack's compiler artifacts on disk between dev server restarts,
    // so a restart doesn't recompile all 54 routes from cold.
    turbopackFileSystemCacheForDev: true,
  },
};

export default nextConfig;
