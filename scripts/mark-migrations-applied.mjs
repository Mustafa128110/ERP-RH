import postgres from "postgres";
import { readdirSync } from "node:fs";

// The live DB is already fully migrated and seeded (set up via drizzle push).
// Supabase CLI's `db push` tracks applied migrations in
// supabase_migrations.schema_migrations; that table doesn't exist here, so a
// future `supabase db push` would try to re-run all 54 migrations against an
// already-migrated database and fail. Marking the full history as applied
// (exactly what `supabase migration repair --status applied` does) makes the
// CLI treat the DB as up to date and future pushes become no-ops.
//
// The version column stores the timestamp only (the migration name lives in
// the separate `name` column) — that is the shape the CLI itself writes when
// it applies a migration, and what its version comparison expects. A version
// containing the full filename stem makes `db push` report "Remote migration
// versions not found in local migrations directory".

const files = readdirSync("supabase/migrations")
  .filter((f) => f.endsWith(".sql"))
  .sort();

const sql = postgres(process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL, { max: 1 });
try {
  // Multi-statement DDL can't go through a prepared statement — use unsafe.
  await sql.unsafe(`
    create schema if not exists supabase_migrations;
    create table if not exists supabase_migrations.schema_migrations (
      version text primary key,
      statements text[] default '{}',
      name text
    )
  `);

  const existing = await sql`select version from supabase_migrations.schema_migrations`;
  const have = new Set(existing.map((r) => r.version));

  let inserted = 0;
  for (const f of files) {
    const version = f.slice(0, f.indexOf("_"));
    if (have.has(version)) continue;
    await sql`
      insert into supabase_migrations.schema_migrations (version, statements, name)
      values (${version}, '{}', ${f.slice(f.indexOf("_") + 1).replace(/\.sql$/, "")})
    `;
    inserted++;
  }

  const [count] = await sql`select count(*)::int as n from supabase_migrations.schema_migrations`;
  console.log(`migrations marked applied: ${inserted} new, ${count.n} total tracked`);
} catch (e) {
  console.error("ERR", e.message);
  process.exit(1);
} finally {
  await sql.end();
}
