// Royal Hardware ERP — service worker.
//
// What this is for:
//   - Repeat visits load instantly: the JS/CSS bundles are served from the
//     cache while a fresh copy is fetched in the background.
//   - The app reads offline. A reload, or a cold open on a dead link, serves the
//     last-seen copy of that page instead of the browser's error page. This is
//     the part experimental.useOffline cannot do on its own — it holds a pending
//     *soft* navigation, but a full page load needs the HTML from somewhere, and
//     the only place left is here.
//
// Two caches, and the split is the whole safety argument:
//   - STATIC_CACHE holds immutable build output and public metadata. Nothing in
//     it is private, so it survives sign-out.
//   - SHELL_CACHE holds rendered pages and RSC payloads, which are somebody's
//     books. It is dropped the moment this browser stops having a session, so it
//     cannot outlive the person who filled it. This app runs on machines a whole
//     shop shares.
//
// What it deliberately does NOT do:
//   - It never caches a write. Server actions are POSTs and are left alone, so a
//     save always reaches the server. Queued offline writes are the outbox's job
//     (lib/outbox.ts), not this file's.
//   - It never answers from the page cache while the server is reachable. Every
//     page request goes to the network first and only falls back on a *failed*
//     request — a 500 stays a 500. Money and stock are never read from a copy
//     when the real number is available.
//   - It cannot replay a session. The proxy refreshes the Supabase cookie on
//     every request (lib/supabase/middleware.ts), but Set-Cookie is not exposed
//     to a service worker — the platform strips it from a response's headers —
//     so a cached page carries no credential and cannot revive a signed-out one.
//   - It does not cache prefetches. Hovering the sidebar or a table row fires one
//     (IntentLink, DataTable's onRowIntent), the payload is a partial the router
//     fills in later, and at that volume they would evict the real pages this
//     cache exists to hold.
//   - Cross-origin requests (Supabase auth, the database pooler) go straight to
//     the network. Caching them here would risk serving a stale token.

const STATIC_CACHE = "erp-static-v2";
const SHELL_CACHE = "erp-shell-v1";
const KEEP = [STATIC_CACHE, SHELL_CACHE];

// Public metadata is pre-cached. Hashed build bundles are cached on first use,
// since their filenames only exist after a build.
const PUBLIC_ASSETS = ["/manifest.json", "/icon.svg"];

// Enough that a day's work stays readable offline, bounded so a browser profile
// on a shared machine doesn't accumulate every party ledger anyone ever opened.
const SHELL_LIMIT = 60;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PUBLIC_ASSETS))
      // A new service worker takes over immediately, so a deployed update
      // reaches the next page load instead of waiting for the tab to close.
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "erp:clear-cache") {
    // Sign-out (components/layout/Topbar.tsx) and the error boundary
    // (app/(dashboard)/error.tsx) both send this. The pages go; the build
    // assets stay, because re-downloading them proves nothing about privacy.
    event.waitUntil(caches.delete(SHELL_CACHE));
  }
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      // Both current caches are kept. Anything else is a retired generation —
      // including "erp-v1", the earlier private-page cache, which must stay
      // deleted rather than be resurrected under a name nothing clears.
      .then((keys) => Promise.all(keys.filter((key) => !KEEP.includes(key)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

function isLoginPath(pathname) {
  return pathname === "/login" || pathname.startsWith("/login/");
}

// True when a response is safe to keep. A redirect means the server answered
// something other than the page that was asked for, and in this app that is
// almost always requireSession() sending an expired session to /login — pinning
// that over a real route would leave the app showing a login page offline
// forever. Browsers also hand some navigation redirects back unfollowed as an
// opaqueredirect, whose status is 0, so `ok` covers that case too.
function storable(response) {
  if (!response.ok || response.redirected) return false;
  if (!response.url) return false;
  return !isLoginPath(new URL(response.url).pathname);
}

// _rsc is a hash of the router state tree, so the same route carries a different
// value on every navigation into it — keyed on that, the cache would never hit.
// Stripped for the key only: the network fetch keeps the original URL, because
// the server redirects when the hash doesn't match what it computes.
//
// The request headers are copied onto the key so the Cache API's own Vary
// matching still applies. Next sends `Vary: rsc, next-router-state-tree, …` on
// these responses, which is what stops a payload computed against one router
// state tree from being handed to a navigation that has a different one — the
// failure that would render a half-populated screen. The explicit marker is
// belt and braces on top: even with no Vary at all, an RSC entry can never
// collide with the cached HTML for the same path.
function rscKey(request, url) {
  const key = new URL(url);
  key.searchParams.delete("_rsc");
  key.searchParams.set("__erp_rsc", "1");
  return new Request(key, { headers: request.headers });
}

// cache.keys() is insertion order and put() re-appends a key it replaces, so
// dropping from the front evicts the page written longest ago.
async function trimShell(cache) {
  const keys = await cache.keys();
  const excess = Math.max(0, keys.length - SHELL_LIMIT);
  for (const stale of keys.slice(0, excess)) await cache.delete(stale);
}

// Static assets: stale-while-revalidate — answer from the cache instantly while
// a fresh copy replaces it in the background. Safe only because these URLs are
// content-hashed, so "stale" and "current" cannot disagree.
function staleWhileRevalidate(request) {
  return caches.open(STATIC_CACHE).then((cache) =>
    cache.match(request).then((cached) => {
      const refresh = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            // Same reason as the shell write below: an abandoned request rejects
            // the put, and an unhandled rejection can cost the worker.
            cache.put(request, copy).catch(() => {});
          }
          return response;
        })
        .catch(() => cached);
      return cached || refresh;
    }),
  );
}

// Pages and RSC payloads: network-first. The cached copy is a fallback for a
// request that could not be made, never a substitute for one that can.
function networkFirst(request, key) {
  return fetch(request)
    .then((response) => {
      if (storable(response)) {
        const copy = response.clone();
        // Not awaited: the page is already on its way to the browser, and the
        // write landing a few ms later changes nothing for this navigation. The
        // catch matters though — cache.put consumes the cloned stream, so a
        // navigation abandoned mid-response rejects here, and an unhandled
        // rejection in a service worker is a worker the browser may recycle.
        caches
          .open(SHELL_CACHE)
          .then((cache) => cache.put(key, copy).then(() => trimShell(cache)))
          .catch(() => {});
      }
      return response;
    })
    .catch((error) =>
      caches
        .open(SHELL_CACHE)
        .then((cache) => cache.match(key))
        .then((cached) => {
          // Nothing cached for this route means this browser has genuinely never
          // seen it. Rethrowing gives the browser's own offline page, which is
          // honest; inventing a shell here would be a screen that shows nothing
          // the database holds.
          if (cached) return cached;
          throw error;
        }),
    );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/_next/static/") || PUBLIC_ASSETS.includes(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // Anything reaching /login means this browser has no session: the sign-out
  // redirect lands here, and so does an expired one. Dropping the page cache
  // here is what makes the clear reliable — Topbar's postMessage is racing a
  // navigation away from the page, and this path does not depend on it winning.
  // The login page itself is never cached.
  if (isLoginPath(url.pathname)) {
    event.waitUntil(caches.delete(SHELL_CACHE));
    return;
  }

  // A prefetch is speculative and its payload is a partial — the router asks for
  // the rest on the real navigation. Hover-prefetching means these outnumber real
  // page loads several times over (IntentLink on every sidebar link, onRowIntent
  // on every table row), so caching them would push the pages someone actually
  // opened out of a bounded cache. Left entirely alone: a prefetch that fails
  // offline costs nothing, and useOffline retries it on reconnect.
  if (request.headers.get("next-router-prefetch") || request.headers.get("next-router-segment-prefetch")) return;

  // A soft navigation carries `rsc: 1`; the `_rsc` param is the same signal
  // surviving a redirect that stripped headers. Prefetches already returned above.
  const isRsc = request.headers.get("rsc") === "1" || url.searchParams.has("_rsc");
  // Everything else — images, /_next/image, API routes — goes to the network
  // untouched, exactly as before.
  if (request.mode !== "navigate" && !isRsc) return;

  event.respondWith(networkFirst(request, isRsc ? rscKey(request, url) : request));
});
