import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Keeps Turbopack's compiler artifacts on disk between dev server restarts,
    // so a restart doesn't recompile all 54 routes from cold.
    turbopackFileSystemCacheForDev: true,
  },
  // No value in advertising the framework to every response.
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: "base-uri 'self'; frame-ancestors 'none'; object-src 'none'; form-action 'self'" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        ],
      },
    ];
  },
};

export default nextConfig;
