"use server";

import { getOfflineReadinessData } from "@/lib/queries/lookups";

// The offline-readiness prep: returns the minimum reference data the three
// offline-supported workflows (quotation, expense, payment) need, in the exact
// shapes the pages seed into the client cache. Thin on purpose — the lookups
// live in lib/queries/lookups.ts (cached, session-gated), so this is a wire
// endpoint and nothing else. The client seeds each list via the existing
// per-user cache (lib/client-cache.ts); no new persistence system.
export async function prepareOfflineReadiness() {
  return getOfflineReadinessData();
}
