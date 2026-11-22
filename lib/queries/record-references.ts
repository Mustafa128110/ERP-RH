import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

type Runner = Pick<typeof db, "execute">;

// Discover every inbound foreign key, including CASCADE/SET NULL links. A new
// referencing table automatically prevents deletion without another handwritten list.
export async function recordReferences(runner: Runner, table: "items" | "contacts", ids: string[]) {
  if (!ids.length) return [];
  const references = await runner.execute<{ schema: string; table: string; column: string }>(sql`
    SELECT ns.nspname AS schema, source.relname AS table, a.attname AS column
    FROM pg_constraint c
    JOIN pg_class source ON source.oid=c.conrelid
    JOIN pg_namespace ns ON ns.oid=source.relnamespace
    JOIN LATERAL unnest(c.conkey) WITH ORDINALITY fk(attnum, position) ON true
    JOIN LATERAL unnest(c.confkey) WITH ORDINALITY pk(attnum, position) ON pk.position=fk.position
    JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=fk.attnum
    JOIN pg_attribute target ON target.attrelid=c.confrelid AND target.attnum=pk.attnum
    WHERE c.contype='f' AND c.confrelid=to_regclass(${`public.${table}`}) AND target.attname='id'
  `);
  if (!references.length) return [];
  const members = sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);
  const counts = await runner.execute<{ table: string; count: number }>(sql.join(references.map((reference) => sql`
    SELECT ${`${reference.schema}.${reference.table}`}::text AS table, count(*)::int AS count
    FROM ${sql.identifier(reference.schema)}.${sql.identifier(reference.table)} WHERE ${sql.identifier(reference.column)} IN (${members})
  `), sql` UNION ALL `));
  return counts.filter((reference) => reference.count > 0);
}
