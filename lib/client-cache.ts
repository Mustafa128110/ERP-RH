"use client";

// Client-side cache of the reference lookups (companies, items, contacts,
// categories, accounts, …) that the forms' ComboBoxes need. The server already
// caches these per process (lib/cache.ts) and renders them into every page, so
// an online visit is never slower for this — the cache's job is the offline
// case: a form opened from the service worker's shell, or a page whose options
// arrived empty, can still fill its pickers from the last good copy.
//
// Two rules keep it honest:
//   - Seeded only from live props (saveClientCache is called by the forms that
//     already receive the options from the server). The client never fetches
//     anything on its own, so there is no second source of truth to drift.
//   - The user can always tell the difference: an offline form whose options
//     came from the cache shows the "Offline" indicator, and the cache is
//     invalidated the moment a queued operation confirms (a queued quotation
//     may have created an item, a queued expense a category).
//
// Keyed per user (erp-cache:<uid>:<kind>) so a shared browser never hands one
// user's reference data to another.

import { useEffect, useSyncExternalStore } from "react";
import { getClientUserId } from "@/lib/client-user";

// The version stamp lives in the key, not the envelope, on purpose: a deployed
// change to an option's shape (say, options gaining a companyId) must make old
// serialized copies unreadable — a stale shape filling an offline form is a
// broken form. Bumping VERSION invalidates every user's cached reference data
// in one move; the next online visit reseeds it. Drafts and the outbox are NOT
// versioned: their payloads are user work and must never be auto-invalidated by
// a deployment (see lib/outbox.ts's parse guards for how those stay safe).
const PREFIX = "erp-cache:v1:";
// A month-old copy of "which brands exist" is not stale in any way that
// matters for filling a form — brands change quarterly at most. The invalidation
// on sync-confirm is the real freshness mechanism; this is only a backstop for
// a copy that somehow outlives its user.
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

type Envelope = { savedAt: number; value: unknown };

function keyFor(kind: string): string {
  const uid = getClientUserId();
  return `${PREFIX}${uid ?? "anon"}:${kind}`;
}

export function saveClientCache(kind: string, value: unknown): void {
  try {
    localStorage.setItem(keyFor(kind), JSON.stringify({ savedAt: Date.now(), value } satisfies Envelope));
  } catch {
    // No cache is better than a broken form — same rule as drafts.
  }
}

export function readClientCache<T>(kind: string): T | null {
  try {
    const raw = localStorage.getItem(keyFor(kind));
    if (!raw) return null;
    const env = JSON.parse(raw) as Envelope;
    if (!env || typeof env.savedAt !== "number" || Date.now() - env.savedAt > MAX_AGE_MS) return null;
    return env.value as T;
  } catch {
    return null;
  }
}

// The whole user's cache, dropped when a queued operation confirms — whatever
// it created, the cache should not keep serving the pre-sync picture. Also
// sweeps the pre-versioning key scheme ("erp-cache:<uid>:") so a cache written
// before the version stamp doesn't linger forever.
export function invalidateClientCache(): void {
  try {
    const uid = getClientUserId();
    const prefixes = [`${PREFIX}${uid ?? "anon"}:`, `erp-cache:${uid ?? "anon"}:`];
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && prefixes.some((p) => k.startsWith(p))) doomed.push(k);
    }
    doomed.forEach((k) => localStorage.removeItem(k));
  } catch {
    // Nothing to do.
  }
}

// The cache never pushes updates (nothing else writes it), so the subscription
// is a no-op. But getSnapshot runs on every render, and useSyncExternalStore
// requires it to return the SAME reference when nothing changed — so the read
// is done once per kind and held, the same pattern lib/draft.ts uses for its
// snapshots. A fresh array per call would make React think the store changed
// every render, which is the infinite loop the error boundary caught.
const noopSubscribe = () => () => {};
const snapshots = new Map<string, unknown>();

// The offline-readiness prep (components/layout/OfflineReadiness.tsx) seeds
// kinds the snapshot map may already hold a null for (a shell that rendered
// before the seed landed). Drop the held snapshots so a form opened next reads
// the fresh cache instead of the stale null.
export function resetCachedSnapshots(): void {
  snapshots.clear();
}

function cachedSnapshot<T>(kind: string): T | null {
  if (!snapshots.has(kind)) snapshots.set(kind, readClientCache<T>(kind));
  return (snapshots.get(kind) as T | null) ?? null;
}

// Returns the live options when there are any (the normal, online case), and
// falls back to the cached copy only when live is empty. Seeding happens in the
// caller: pass live options and this hook saves them for the next offline
// moment. `stale` is true only when the value came from the cache — a caller
// can say so in the UI rather than present cached data as current.
export function useCachedOptions<T>(kind: string, live: T): { value: T; stale: boolean } {
  const cached = useSyncExternalStore(noopSubscribe, () => cachedSnapshot<T>(kind), () => null);

  const hasLive = Array.isArray(live) ? live.length > 0 : live !== undefined && live !== null;

  // Seed the cache whenever live options arrive — the next offline moment will
  // read this copy. Writes only when the contents changed, so a parent that
  // re-renders with a fresh array reference doesn't rewrite identical data.
  useEffect(() => {
    if (!hasLive) return;
    const same = JSON.stringify(cached) === JSON.stringify(live);
    if (!same) {
      saveClientCache(kind, live);
      // The held snapshot is stale now — a later offline render should see what
      // was just seeded, not the older copy.
      snapshots.set(kind, live);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, live]);

  // Derived, not stored: live data is never stale, cached data always is (it is
  // a copy of an older moment by definition).
  const stale = !hasLive && cached !== null;
  return { value: hasLive ? live : (cached as T), stale };
}
