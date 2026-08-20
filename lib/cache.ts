import "server-only";

// One in-process cache behind everything that reads rarely-changing data. The
// database is ~170ms away, so a lookup table that changes twice a month should
// not cost a round trip on every render.
//
// Entries hold the in-flight promise rather than the resolved value, which is
// what makes this safe under concurrency: the stock-purchase page fires twelve
// lookups at once, and on a cold cache all twelve share one query each instead
// of stampeding the database. A rejected load evicts itself so a transient
// failure isn't cached.
//
// Correctness rests on explicit invalidation, not on the TTL — every mutation
// that writes one of these tables calls invalidate() for it. The TTL is only a
// backstop for anything that learns to write behind our back (a migration, a
// psql session, a future action nobody wired up).
//
// Design note: per-instance Map. Correct for the single server this runs on. Behind
// a load balancer each instance would keep its own copy and invalidation would
// only clear the instance that served the mutation — move to Redis at that point,
// or set TTL to 0 and take the round trip back.

type Entry = { expires: number; value: Promise<unknown> };

const globalForCache = globalThis as unknown as { appCache?: Map<string, Entry> };
const store = (globalForCache.appCache ??= new Map<string, Entry>());

// Expired entries are never visited again, so without a bound an instance that
// serves a lot of distinct keys would keep them all in memory forever — the
// report cache is keyed per filter combination, so a month of report views is
// a month of entries. A sweep on insert drops everything already past its TTL
// whenever the store grows past the cap, which keeps the cost amortised O(1)
// and only ever removes data that is already dead.
const MAX_ENTRIES = 1000;

export const MINUTE = 60_000;

export function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as Promise<T>;

  if (store.size > MAX_ENTRIES) {
    const now = Date.now();
    for (const [k, entry] of store) {
      if (entry.expires <= now) store.delete(k);
    }
  }

  const value = load().catch((err) => {
    store.delete(key);
    throw err;
  });
  store.set(key, { expires: Date.now() + ttlMs, value });
  return value;
}

// Clears each key and any parameterised variants of it — invalidate("cheques")
// also drops "cheques:<documentId>:<expenseId>".
export function invalidate(...keys: string[]) {
  for (const key of keys) {
    store.delete(key);
    for (const existing of store.keys()) {
      if (existing.startsWith(key + ":")) store.delete(existing);
    }
  }
}

export function invalidateAll() {
  store.clear();
}
