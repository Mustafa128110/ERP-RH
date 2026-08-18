// Royal Hardware ERP — service worker.
//
// What this is for:
//   - Repeat visits load instantly: the JS/CSS bundles are served from the
//     cache while a fresh copy is fetched in the background.
//   - Only immutable build assets and public metadata are cached. Authenticated
//     HTML, RSC payloads, API responses, and images always go to the network.
//
// What it deliberately does NOT do:
//   - It never caches a write. Server actions are POSTs and are left alone, so
//     a save always reaches the server. "Offline" here means reading and
//     continuing to type (drafts live in localStorage, see lib/draft.ts), not
//     queuing edits to sync later — the server stays the source of truth for
//     money, stock and document numbers.
//   - Cross-origin requests (Supabase auth, the database pooler) go straight to
//     the network. Caching them here would risk serving a stale token.

const CACHE = "erp-static-v2";

// Public metadata is pre-cached. Hashed build bundles are cached on first use,
// since their filenames only exist after a build.
const PUBLIC_ASSETS = ["/manifest.json", "/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PUBLIC_ASSETS))
      // A new service worker takes over immediately, so a deployed update
      // reaches the next page load instead of waiting for the tab to close.
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "erp:clear-cache") {
    event.waitUntil(caches.delete(CACHE));
  }
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never intercept a navigation or an RSC/data request. Those responses carry
  // company and user data and must not survive logout in a shared browser.
  const isPublicStatic = url.pathname.startsWith("/_next/static/") || PUBLIC_ASSETS.includes(url.pathname);
  if (!isPublicStatic) return;

  // Static assets (_next/static/*, fonts, the icon): stale-while-revalidate — answer
  // from the cache instantly while a fresh copy replaces it in the background.
  event.respondWith(
    caches.match(request).then((cached) => {
      const refresh = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || refresh;
    }),
  );
});
