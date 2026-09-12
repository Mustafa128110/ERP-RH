import assert from "node:assert/strict";
import {sql} from "drizzle-orm";
import {db} from "./index";
import {cacheGeneration} from "../cache-generation";
async function main() {
 const missing = await db.execute(sql`SELECT tablename FROM pg_tables t WHERE schemaname='public' AND tablename NOT IN ('cache_revisions','command_receipts','submitted_operations','audit_logs','whatsapp_messages') AND NOT EXISTS(SELECT 1 FROM pg_trigger g WHERE g.tgrelid=('public.'||t.tablename)::regclass AND g.tgname='erp_cache_revision' AND g.tgenabled='O')`);
 assert.deepEqual([...missing],[],"Every business table must advance its cache generation");
 const before = await db.select().from((await import('./schema')).cacheRevisions);
 const rollback = new Error('rollback fixture');
 try {await db.transaction(async tx=>{
  const [brand] = await tx.execute<{id:string}>(sql`SELECT id FROM brands LIMIT 1`);
  const versions = Object.fromEntries(before.map(row=>[row.name,String(row.version)]));
  await tx.execute(sql`UPDATE brands SET name=name WHERE id=${brand.id}::uuid`);
  const changed = await tx.execute<{name:string;version:string}>(sql`SELECT name,version::text FROM cache_revisions`);
  const after = Object.fromEntries(changed.map(row=>[row.name,row.version]));
  assert.notEqual(cacheGeneration('brands',versions),cacheGeneration('brands',after));
  assert.equal(cacheGeneration('companies',versions),cacheGeneration('companies',after));
  throw rollback;
 });} catch(error){if(error!==rollback)throw error;}
 const after = await db.select().from((await import('./schema')).cacheRevisions);
 assert.deepEqual(after.sort((a,b)=>a.name.localeCompare(b.name)),before.sort((a,b)=>a.name.localeCompare(b.name)),"A rolled-back write cannot invalidate another instance");
 console.log('Database cache revision checks passed: complete trigger coverage, transactionally advanced generation and rollback isolation');
}
main().finally(()=>db.$client.end()).catch(error=>{console.error(error);process.exitCode=1;});
