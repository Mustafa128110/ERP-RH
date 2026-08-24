import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Keeps Turbopack's compiler artifacts on disk between dev server restarts,
    // so a restart doesn't recompile all 54 routes from cold.
    turbopackFileSystemCacheForDev: true,
    // A Server Action called with no usable network stops rejecting: Next holds
    // it pending and re-runs it when the connection returns. Every form in the
    // app gets that, not just the three the outbox knows how to queue — a shop
    // on a dropping link no longer loses what was typed into a sale.
    //
    // This is only safe because every create claims a client-minted operationId
    // as the first statement of its transaction (lib/actions/operation-id.ts),
    // so an automatic re-run of a call that actually committed is refused as a
    // duplicate rather than posted twice. Do not weaken that.
    //
    // Turning the flag off restores today's TRANSPORT_ERROR_MESSAGE behaviour
    // with no other code change: useOffline() then returns false everywhere,
    // which the callers already read as "online".
    useOffline: true,
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
