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
    // The client router cache keeps a rendered route segment so navigating back
    // to it needs no round trip. Every dashboard page is force-dynamic, so these
    // segments fall under `dynamic` — which Next 16 defaults to 0 seconds, i.e.
    // never cached, so a switch back to a page re-renders it from the server
    // every time (~170ms round trip). A positive value means a page that has been
    // opened stays instant on return; the server-side cachedPageRead (and a
    // revalidatePath on the next write) still refreshes it behind the scenes.
    //
    // 60s: long enough that the five screens someone lives in all day are always
    // warm, short enough that a row edited on another screen is stale for at most
    // a minute before the next visit pulls the fresh server copy.
    staleTimes: {
      dynamic: 60,
      static: 180,
    },
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
