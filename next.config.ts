import type { NextConfig } from "next";

const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://vitals.vercel-insights.com",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "form-action 'self'",
  ...(process.env.NODE_ENV === "production" ? ["upgrade-insecure-requests"] : []),
].join("; ");

const nextConfig: NextConfig = {
  // Keep the framework default explicit. A batch grid must fit comfortably,
  // but an authenticated caller must not be able to hand the server an
  // unbounded JSON payload and turn one action into a memory/SQL denial of
  // service. Next also performs its Origin-vs-Host CSRF check for these calls.
  experimental: {
    serverActions: {
      bodySizeLimit: "1mb",
    },
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
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
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
