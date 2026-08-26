import "server-only";
import { Redis } from "@upstash/redis";

// L1 coalesces duplicate work in one process.  Upstash is only the shared L2:
// a quota, network, or service failure must make reads slower, never stale or
// unavailable.  Versioned keys avoid expensive key scans and make invalidation
// one small command per logical lookup prefix.
type Entry = { expires: number; value: Promise<unknown> };
type CacheGlobals = {
  appCache?: Map<string, Entry>;
  upstashClient?: Redis | null;
  circuitUntil?: number;
  epochRequired?: boolean;
};

const globalForCache = globalThis as unknown as CacheGlobals;
const store = (globalForCache.appCache ??= new Map<string, Entry>());
const MAX_ENTRIES = 1000;
const NAMESPACE = "erp:cache:v1";
const CIRCUIT_MS = 60_000;

export const MINUTE = 60_000;

function localCached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as Promise<T>;
  if (store.size > MAX_ENTRIES) {
    const now = Date.now();
    for (const [existingKey, entry] of store) if (entry.expires <= now) store.delete(existingKey);
  }
  const value = load().catch((error) => { store.delete(key); throw error; });
  store.set(key, { expires: Date.now() + ttlMs, value });
  return value;
}

function client(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  if (globalForCache.upstashClient === undefined) globalForCache.upstashClient = new Redis({ url, token });
  return globalForCache.upstashClient;
}

function unavailable() {
  globalForCache.circuitUntil = Date.now() + CIRCUIT_MS;
  // A failed shared invalidation means this process cannot trust any value it
  // previously saw.  The next healthy L2 call advances the global epoch first.
  globalForCache.epochRequired = true;
  store.clear();
}

async function shared<T>(operation: (redis: Redis) => Promise<T>): Promise<T | null> {
  const redis = client();
  if (!redis || (globalForCache.circuitUntil ?? 0) > Date.now()) return null;
  try {
    if (globalForCache.epochRequired) {
      await redis.incr(versionKey("all"));
      globalForCache.epochRequired = false;
    }
    const result = await operation(redis);
    globalForCache.circuitUntil = 0;
    return result;
  } catch {
    unavailable();
    return null;
  }
}

function prefixes(key: string) {
  const parts = key.split(":");
  return ["all", ...parts.map((_, index) => parts.slice(0, index + 1).join(":"))];
}

function versionKey(prefix: string) { return `${NAMESPACE}:version:${prefix}`; }
function valueKey(key: string, versions: string[]) { return `${NAMESPACE}:value:${Buffer.from(key).toString("base64url")}:${versions.join(":")}`; }

async function versionsFor(redis: Redis, key: string) {
  const values = await redis.mget<string[]>(...prefixes(key).map(versionKey));
  return values.map((value) => value ?? "0");
}

export async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const redis = client();
  if (!redis) return process.env.NODE_ENV === "production" ? load() : localCached(key, ttlMs, load);
  const versions = await shared((ready) => versionsFor(ready, key));
  if (!versions) return load();
  const sharedKey = valueKey(key, versions);
  return localCached(sharedKey, ttlMs, async () => {
    const serialized = await shared((ready) => ready.get<string>(sharedKey));
    if (serialized !== null && serialized !== undefined) {
      try { return JSON.parse(serialized) as T; } catch { /* corrupted cache is a miss */ }
    }
    const value = await load();
    await shared((ready) => ready.set(sharedKey, JSON.stringify(value), { px: ttlMs }));
    return value;
  });
}

function clearLocal(keys: string[]) {
  for (const key of keys) {
    const encoded = Buffer.from(key).toString("base64url");
    for (const existing of store.keys()) if (existing === key || existing.startsWith(`${key}:`) || existing.includes(`:${encoded}:`)) store.delete(existing);
  }
}

export async function invalidate(...keys: string[]) {
  clearLocal(keys);
  if (keys.length === 0) return;
  const result = await shared((ready) => Promise.all(keys.map((key) => ready.incr(versionKey(key)))));
  // shared() already opens the circuit and clears L1 on an error.  This remains
  // deliberately non-throwing because writes must commit even when cache quota
  // is exhausted.
  void result;
}

export async function invalidateAll() {
  store.clear();
  await shared((ready) => ready.incr(versionKey("all")));
}
