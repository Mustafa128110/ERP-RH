"use client";

// Offline readiness: the reference data the supported offline workflows need,
// and the truthful state of whether it is all present.
//
// The dependency set is DERIVED from the forms, not invented (lib/offline-
// readiness.check.ts re-derives it from the managers' useCachedOptions calls
// and fails if they drift):
//   quotation — companies, customers, items, units
//   expense   — companies, expenseCategories, contacts, bankAccounts, cashAccounts, cheques
//   payment   — companies, contacts, bankAccounts, cashAccounts, cheques
// Anything a picker in those three forms reads is in the union; anything not in
// the union is deliberately not prepared (sales/stock forms stay server-
// required and their reference data is not cached for offline).
//
// Readiness is derived from the cache itself, never from what the prep *thinks*
// it wrote: a seed that failed (quota, private mode) leaves a kind missing and
// the state honestly reads "limited". A kind counts as prepared when its cache
// key exists — an empty list is a prepared list (a company with no cheques has
// nothing to fill a picker with, and must not read as "not ready").

import { useSyncExternalStore } from "react";
import { readClientCache } from "@/lib/client-cache";

export const OFFLINE_WORKFLOWS = {
  quotation: ["companies", "customers", "items", "units"],
  expense: ["companies", "expenseCategories", "contacts", "bankAccounts", "cashAccounts", "cheques"],
  payment: ["companies", "contacts", "bankAccounts", "cashAccounts", "cheques"],
} as const;

export const OFFLINE_KINDS: readonly string[] = [...new Set(Object.values(OFFLINE_WORKFLOWS).flat())];

export type OfflineReadinessState = "preparing" | "ready" | "limited";

// Only "preparing" is a real stored state (set while the prep is in flight).
// "ready"/"limited" are always derived from the cache on read, so a returning
// offline user with a full cache reads "ready" on the very first frame.
let preparing = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function setOfflineReadinessPreparing(): void {
  if (preparing) return;
  preparing = true;
  emit();
}

export function clearOfflineReadinessPreparing(): void {
  if (!preparing) return;
  preparing = false;
  emit();
}

function missingKinds(): string[] {
  return OFFLINE_KINDS.filter((kind) => readClientCache<unknown>(kind) === null);
}

export function computeOfflineReadiness(): OfflineReadinessState {
  return missingKinds().length === 0 ? "ready" : "limited";
}

// Wake any subscriber (the pill) after the cache changed — the snapshot is
// derived on read, so waking is enough. Called after a prep completes or
// fails, and after a sync-confirm invalidated the cache.
export function refreshOfflineReadiness(): void {
  clearOfflineReadinessPreparing();
  emit();
}

// The sync engine calls this when a queued operation confirms and the client
// cache is dropped: readiness is stale until the prep refills it, and the prep
// component subscribes to this counter to run again.
let invalidations = 0;
const invalidationListeners = new Set<() => void>();

export function noteOfflineCacheInvalidated(): void {
  invalidations += 1;
  for (const l of invalidationListeners) l();
}

export function subscribeOfflineInvalidations(fn: () => void): () => void {
  invalidationListeners.add(fn);
  return () => {
    invalidationListeners.delete(fn);
  };
}

export function getOfflineCacheInvalidations(): number {
  return invalidations;
}

export function subscribeOfflineReadiness(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getOfflineReadinessSnapshot(): OfflineReadinessState {
  if (preparing) return "preparing";
  return computeOfflineReadiness();
}

// The server and the pre-hydration frame report "limited" — the truthful state
// for a frame that has read no cache yet (useSyncExternalStore reconciles to
// the real value after hydration).
const serverSnapshot = (): OfflineReadinessState => "limited";

export function useOfflineReadiness(): OfflineReadinessState {
  return useSyncExternalStore(subscribeOfflineReadiness, getOfflineReadinessSnapshot, serverSnapshot);
}
