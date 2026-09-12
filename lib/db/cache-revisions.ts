import "server-only";
import { sql } from "drizzle-orm";
import { db } from "./index";

let inFlight: Promise<Record<string, string> | null> | undefined;
// Coalesce concurrent lookup reads, without retaining a version past completion.
// A later request must observe commits made on another instance or through SQL.
export function readCacheVersions(): Promise<Record<string, string> | null> {
  return inFlight ??= (async () => {
    try {
      const rows = await db.execute<{ name: string; version: string }>(sql`SELECT name, version::text FROM public.cache_revisions ORDER BY name`);
      return rows.length ? Object.fromEntries(rows.map(row => [row.name, row.version])) : null;
    } catch { return null; } // Missing migration or unavailable DB: bypass cache.
    finally { inFlight = undefined; }
  })();
}
