// Deliberately applies only reviewed migration 0074 to the Singapore project.
// Require evidence of a recently verified backup before any hosted write.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import postgres from 'postgres';
const ref='gvneuhadkktmhoxaazzg';
const url=new URL(process.env.DATABASE_URL_DIRECT||'');
assert.ok(url.hostname===`db.${ref}.supabase.co`||decodeURIComponent(url.username)===`postgres.${ref}`,'Unexpected database target');
assert.equal(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname,`${ref}.supabase.co`);
const verification=JSON.parse(readFileSync(process.argv[2],'utf8'));
assert.equal(verification.all_table_digests_match,true);
assert.equal(verification.all_constraints_valid,true);
assert.ok(Date.now()-Date.parse(verification.verified_at)<24*60*60*1000,'A fresh verified restore is required');
const migration=readFileSync('drizzle/0074_cache_revisions.sql','utf8');
assert.equal(migration,readFileSync('supabase/migrations/20260911000074_cache_revisions.sql','utf8'));
const db=postgres(url.toString(),{max:1,onnotice:()=>{}});
try{
 await db.begin(async tx=>{
  await tx`SET LOCAL lock_timeout='10s'`;
  await tx`SET LOCAL statement_timeout='60s'`;
  const [existing]=await tx`SELECT to_regclass('public.cache_revisions') AS relation`;
  assert.equal(existing.relation,null,'Migration appears applied already; inspect rather than replay');
  await tx.unsafe(migration);
  await tx`INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES ('20260911000074','cache_revisions',${[migration]})`;
 });
 console.log('Singapore migration 0074 applied and registered atomically. No historical migrations replayed.');
}finally{await db.end()}
