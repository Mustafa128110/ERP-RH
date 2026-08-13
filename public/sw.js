// Royal Hardware ERP — service worker.
//
// What this is for:
//   - Repeat visits load instantly: the JS/CSS bundles are served from the
//     cache while a fresh copy is fetched in the background.
//   - The app works offline for pages already visited: a navigation is served
//     network-first, falls back to the last good copy of that page, then to the
//     app shell.
//
// What it deliberately does NOT do:
//   - It never caches a write. Server actions are POSTs and are left alone, so
//     a save always reaches the server. "Offline" here means reading and
//     continuing to type (drafts live in localStorage, see lib/draft.ts), not
//     queuing edits to sync later — the server stays the source of truth for
//     money, stock and document numbers.
//   - Cross-origin requests (Supabase auth, the database pooler) go straight to
//     the network. Caching them here would risk serving a stale token.

const CACHE = "erp-v1";

// Pages that make the app usable with no network at all. The rest of the shell
// (hashed _next bundles) is cached on first use, since its filenames only exist
// after a build.
const SHELL = ["/", "/login", "/manifest.json", "/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      // A new service worker takes over immediately, so a deployed update
      // reaches the next page load instead of waiting for the tab to close.
      .then(() => self.skipWaiting()),
  );
});

// The error boundary (app/(dashboard)/error.tsx) posts here when a page fails:
// its last response may have been cached as a 200, and that poisoned copy must
// not be what offline mode serves next time.
self.addEventListener("message", (event) => {
  if (event.data?.type !== "erp:clear-page") return;
  const url = new URL(event.data.url);
  if (url.origin !== self.location.origin) return;
  caches.open(CACHE).then((cache) => cache.delete(url.href));
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

  // Navigations: the newest page wins when online; offline, the last good copy
  // of this exact URL, then the shell.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          return cached || caches.match("/");
        }),
    );
    return;
  }

  // Static assets (_next/*, fonts, the icon): stale-while-revalidate — answer
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
