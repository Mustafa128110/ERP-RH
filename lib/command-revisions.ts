import "server-only";
import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "./db/schema";

// table comes exclusively from the command allowlist. Lock in a stable order
// so the version check and subsequent writes use the same protected rows.
export async function commandRevisionsMatch(tx: PostgresJsDatabase<typeof schema>, table: string, expected: [string, string][]): Promise<boolean> {
  if (!expected.length) return true;
  const ids = expected.map(([key]) => key.slice(table.length + 1));
  if (ids.some(id => !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(id))) return false;
  const rows = await tx.execute<{ id: string; revision: string }>(sql`SELECT id, xmin::text AS revision FROM ${sql.identifier(table)} WHERE id IN (${sql.join(ids.map(id => sql`${id}::uuid`), sql`, `)}) ORDER BY id FOR UPDATE`);
  const current = new Map(rows.map(row => [`${table}:${row.id}`, row.revision]));
  return expected.every(([key, revision]) => current.get(key) === revision);
}
