import "server-only";
import { cached, MINUTE } from "@/lib/cache";
import { CACHE } from "@/lib/cache-keys";

// Page lists are much hotter than the data behind them: users move between the
// same five screens all day while writes are comparatively rare. Keep the
// already-shaped result briefly in process and invalidate it after every write.
// The user id and effective scope belong in `key`; callers retain their auth
// check outside the cache so a cached result never becomes an authorization
// decision.
const PAGE_TTL = MINUTE;

export function cachedPageRead<T>(key: string, load: () => Promise<T>): Promise<T> {
  return cached(`${CACHE.pageReads}:${key}`, PAGE_TTL, load);
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
