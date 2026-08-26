import "server-only";
import { cached, invalidate, MINUTE } from "@/lib/cache";
import { CACHE, type ReadDomain } from "@/lib/cache-keys";

// Page lists are much hotter than the data behind them: users move between the
// same five screens all day while writes are comparatively rare. Keep the
// already-shaped result briefly in process and invalidate it after every write
// that can change it. The user id and effective scope belong in `key`; callers
// retain their auth check outside the cache so a cached result never becomes an
// authorization decision.
//
// Five minutes rather than one, matching the lookups. The short TTL was standing
// in for precise invalidation — every write dropped every page read, so nothing
// stayed warm long enough for the TTL to matter. Now that a write only clears the
// domains it can reach (invalidateReads in lib/queries/lookups.ts), the TTL is
// back to being what it is for the lookups: a backstop for something writing
// behind our back, not the thing keeping the list correct.
const PAGE_TTL = 5 * MINUTE;

// `domain` is what makes this invalidable on its own: the key is
// `page_reads:<domain>:<rest>`, and invalidate() drops a key together with every
// `key:` variant, so clearing one screen's reads leaves the other seven warm.
export function cachedPageRead<T>(domain: ReadDomain, key: string, load: () => Promise<T>): Promise<T> {
  return cached(`${CACHE.pageReads}:${domain}:${key}`, PAGE_TTL, load);
}

// The other half of the pair: drop every entry of one domain, for every user and
// every scope, by invalidating its prefix. Called after the commit, with each
// domain the written tables appear in — lib/cache.check.ts derives that set from
// READ_DEPENDS_ON and READ_DOCUMENT_TYPES and fails a file that names fewer than
// its writes can reach.
//
// It lives here rather than beside invalidateLookups so that the helpers running
// inside another action's transaction (lib/actions/cheque-link.ts) can clear a
// read without pulling the session-aware lookup module into their import graph —
// the same reason lib/cache-keys.ts is dependency-free. lib/queries/lookups.ts
// re-exports it, which is where the action files import it from.
export async function invalidateReads(...domains: ReadDomain[]) {
  await invalidate(...domains.map((domain) => `${CACHE.pageReads}:${domain}`));
}

export function stableReadKey(value: unknown) {
  if (value == null) return "";
  if (typeof value !== "object") return String(value);
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry != null && entry !== "")
        .sort(([a], [b]) => a.localeCompare(b)),
    ),
  );
}
