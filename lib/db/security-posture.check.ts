import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { db } from "./index";

type Exposure = {
  table_name: string;
  anon_select: boolean;
  anon_insert: boolean;
  anon_update: boolean;
  anon_delete: boolean;
  authenticated_select: boolean;
  authenticated_insert: boolean;
  authenticated_update: boolean;
  authenticated_delete: boolean;
};

async function main() {
  const roles = await db.execute<{ role_name: string; superuser: boolean; bypass_rls: boolean }>(sql`
    SELECT rolname AS role_name, rolsuper AS superuser, rolbypassrls AS bypass_rls
      FROM pg_roles
     WHERE rolname IN ('anon', 'authenticated')
     ORDER BY rolname
  `);
  assert.deepEqual(roles.map((role) => role.role_name), ["anon", "authenticated"], "Supabase public API roles are missing");
  assert.ok(roles.every((role) => !role.superuser && !role.bypass_rls), "Supabase public API roles must never be superuser or BYPASSRLS");

  const rows = await db.execute<Exposure>(sql`
    SELECT c.relname AS table_name,
           has_table_privilege('anon', c.oid, 'SELECT') AS anon_select,
           has_table_privilege('anon', c.oid, 'INSERT') AS anon_insert,
           has_table_privilege('anon', c.oid, 'UPDATE') AS anon_update,
           has_table_privilege('anon', c.oid, 'DELETE') AS anon_delete,
           has_table_privilege('authenticated', c.oid, 'SELECT') AS authenticated_select,
           has_table_privilege('authenticated', c.oid, 'INSERT') AS authenticated_insert,
           has_table_privilege('authenticated', c.oid, 'UPDATE') AS authenticated_update,
           has_table_privilege('authenticated', c.oid, 'DELETE') AS authenticated_delete
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
     ORDER BY c.relname
  `);

  const exposed = rows.filter((row) =>
    row.anon_select || row.anon_insert || row.anon_update || row.anon_delete ||
    row.authenticated_select || row.authenticated_insert || row.authenticated_update || row.authenticated_delete,
  );
  assert.deepEqual(
    exposed,
    [],
    `public tables bypass the server-only data boundary through anon/authenticated grants: ${exposed.map((row) => row.table_name).join(", ")}`,
  );

  const sequences = await db.execute<{
    sequence_name: string;
    anon_usage: boolean;
    anon_select: boolean;
    anon_update: boolean;
    authenticated_usage: boolean;
    authenticated_select: boolean;
    authenticated_update: boolean;
  }>(sql`
    SELECT c.relname AS sequence_name,
           has_sequence_privilege('anon', c.oid, 'USAGE') AS anon_usage,
           has_sequence_privilege('anon', c.oid, 'SELECT') AS anon_select,
           has_sequence_privilege('anon', c.oid, 'UPDATE') AS anon_update,
           has_sequence_privilege('authenticated', c.oid, 'USAGE') AS authenticated_usage,
           has_sequence_privilege('authenticated', c.oid, 'SELECT') AS authenticated_select,
           has_sequence_privilege('authenticated', c.oid, 'UPDATE') AS authenticated_update
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'S'
     ORDER BY c.relname
  `);
  const exposedSequences = sequences.filter((row) =>
    row.anon_usage || row.anon_select || row.anon_update ||
    row.authenticated_usage || row.authenticated_select || row.authenticated_update,
  );
  assert.deepEqual(exposedSequences, [], `public sequences are exposed to anon/authenticated: ${exposedSequences.map((row) => row.sequence_name).join(", ")}`);

  const routines = await db.execute<{
    routine_name: string;
    anon_execute: boolean;
    authenticated_execute: boolean;
  }>(sql`
    SELECT p.oid::regprocedure::text AS routine_name,
           has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
     ORDER BY p.oid::regprocedure::text
  `);
  const exposedRoutines = routines.filter((row) => row.anon_execute || row.authenticated_execute);
  assert.deepEqual(exposedRoutines, [], `public routines are exposed to anon/authenticated: ${exposedRoutines.map((row) => row.routine_name).join(", ")}`);

  const [schemaAccess] = await db.execute<{
    anon_usage: boolean;
    anon_create: boolean;
    authenticated_usage: boolean;
    authenticated_create: boolean;
  }>(sql`
    SELECT has_schema_privilege('anon', 'public', 'USAGE') AS anon_usage,
           has_schema_privilege('anon', 'public', 'CREATE') AS anon_create,
           has_schema_privilege('authenticated', 'public', 'USAGE') AS authenticated_usage,
           has_schema_privilege('authenticated', 'public', 'CREATE') AS authenticated_create
  `);
  assert.ok(
    schemaAccess && !schemaAccess.anon_usage && !schemaAccess.anon_create && !schemaAccess.authenticated_usage && !schemaAccess.authenticated_create,
    "anon/authenticated must have no effective access to the public schema",
  );

  console.log(`database API security posture passed (${rows.length} relations, ${sequences.length} sequences, ${routines.length} routines)`);
  process.exit(0);
}

main();
