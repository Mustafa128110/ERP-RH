"use client";

// After login, fetch the minimum reference data the offline workflows need and
// seed the existing per-user client cache (lib/client-cache.ts) — so a first
// offline moment is ready without ever having visited the quotation, expense or
// payment pages. Deliberately the minimum: the option lists those three forms'
// pickers read, in the exact shapes the pages seed (getOfflineReadinessData in
// lib/queries/lookups.ts). Page visits still seed as they always did, and a
// sync-confirm still invalidates — readiness re-prepares after either.
//
// Truthful states: "preparing" only while the fetch is in flight; "ready" only
// when every required kind is actually present in the cache (derived on read,
// see lib/offline-readiness.ts); "limited" when the fetch failed or a seed
// didn't land. A failure never claims readiness — the pill says limited.

import { useEffect, useRef, useSyncExternalStore } from "react";
import { useClientUserId } from "@/lib/client-user";
import { saveClientCache, resetCachedSnapshots } from "@/lib/client-cache";
import { prepareOfflineReadiness } from "@/lib/actions/offline";
import {
  setOfflineReadinessPreparing,
  refreshOfflineReadiness,
  subscribeOfflineInvalidations,
  getOfflineCacheInvalidations,
} from "@/lib/offline-readiness";

export function OfflineReadiness() {
  const userId = useClientUserId();
  // The invalidation counter is a reactive signal: a sync-confirm drops the
  // cache, and the prep must run again to refill it (the drain bumps the
  // counter via noteOfflineCacheInvalidated).
  const invalidations = useSyncExternalStore(subscribeOfflineInvalidations, getOfflineCacheInvalidations, () => 0);
  const preparedFor = useRef<string | null>(null);
  const seenInvalidations = useRef(0);

  // Whatever the cache holds right now is the truth — a returning user's
  // previously prepared (or page-seeded) data counts immediately, even offline.
  useEffect(() => {
    refreshOfflineReadiness();
  }, []);

  useEffect(() => {
    if (!userId) return;
    // Prepare once per user per page life, and again after every cache
    // invalidation (a queued operation confirmed and the cache was dropped).
    if (preparedFor.current === userId && seenInvalidations.current === invalidations) return;
    preparedFor.current = userId;
    seenInvalidations.current = invalidations;

    setOfflineReadinessPreparing();
    let cancelled = false;
    void (async () => {
      try {
        const data = await prepareOfflineReadiness();
        if (cancelled) return;
        for (const [kind, value] of Object.entries(data)) {
          // Seed even empty lists: an empty list is a prepared list, and
          // readiness must not read a company with no cheques as "not ready".
          if (Array.isArray(value)) saveClientCache(kind, value);
        }
        // A useCachedOptions caller may already hold a stale null snapshot for
        // a kind (a shell that rendered before the seed) — drop those so a
        // form opened next reads the fresh cache.
        resetCachedSnapshots();
      } catch {
        // Unreachable right now (offline, DNS, the server hiccuping). Nothing
        // to seed; the refresh below reports limited honestly. The next
        // `online` event, page load, or sync re-runs the prep — never a silent
        // claim of readiness.
      } finally {
        // Clear the "preparing" latch even if the run was cancelled (unmount,
        // user switch): a fresh prep re-sets it, and a stale latch would make
        // the pill claim "Preparing…" forever.
        refreshOfflineReadiness();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, invalidations]);

  return null;
}
