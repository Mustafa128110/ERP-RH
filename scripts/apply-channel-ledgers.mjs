// Apply only after an exact local rehearsal and a fresh, restored local backup.
import assert from "node:assert/strict";
import postgres from "postgres";
import {readFileSync,writeFileSync} from "node:fs";
import {resolve,join} from "node:path";
import {createHash} from "node:crypto";
const local=process.argv[2]==="--local";assert.ok(local||process.argv[2]==="--apply");
const folder=resolve(process.argv[3]);assert.ok(folder.startsWith(resolve("db-export")+"\\"));
const proof=JSON.parse(readFileSync(join(folder,"restore-verification.json"),"utf8"));
assert.equal(proof.all_table_digests_match,true);assert.equal(proof.all_constraints_valid,true);
assert.ok(Date.now()-Date.parse(proof.verified_at)<86400000,"Use a freshly restored backup");
const migration=readFileSync("drizzle/0076_channel_ledgers_stock_conversion.sql","utf8");assert.equal(migration,readFileSync("supabase/migrations/20261122000076_channel_ledgers_stock_conversion.sql","utf8"));
const hash=createHash("sha256").update(migration).digest("hex");
if(!local){const rehearsal=JSON.parse(readFileSync(join(folder,"features-rehearsal.json"),"utf8"));assert.equal(rehearsal.migration_sha256,hash);assert.equal(rehearsal.all_financial_digests_match,true);}
let database;
if(local){assert.match(proof.database,/^restore_\d+$/);database=`feature_check_${Date.now()}`;const admin=postgres("postgresql://restore_verify@127.0.0.1:55474/postgres",{max:1,onnotice:()=>{}});try{await admin.unsafe(`CREATE DATABASE "${database}" TEMPLATE "${proof.database}"`);}finally{await admin.end({timeout:5});}}
const url=local?`postgresql://restore_verify@127.0.0.1:55474/${database}`:process.env.DATABASE_URL_DIRECT;
if(!local){const target=new URL(url);assert.ok(target.hostname==="db.gvneuhadkktmhoxaazzg.supabase.co"||decodeURIComponent(target.username)==="postgres.gvneuhadkktmhoxaazzg");}
const db=postgres(url,{max:1,ssl:local?false:"require",connect_timeout:20,onnotice:()=>{}});
const tables={documents:"(to_jsonb(t)-'ledger_closed_at'-'sale_type')||jsonb_build_object('sale_type',coalesce(t.sale_type::text,'counter'))",expenses:"to_jsonb(t)-'sale_type'",document_lines:"to_jsonb(t)",inventory_transactions:"to_jsonb(t)",ledger_entries:"to_jsonb(t)",payment_allocations:"to_jsonb(t)",items:"to_jsonb(t)",contacts:"to_jsonb(t)",bank_accounts:"to_jsonb(t)",cash_accounts:"to_jsonb(t)",cheque_register:"to_jsonb(t)",document_number_ledger:"to_jsonb(t)",market_purchase_requests:"to_jsonb(t)"};
async function fingerprints(tx){return [...await tx.unsafe(Object.entries(tables).map(([table,projection])=>`SELECT '${table}' AS name,count(*)::int AS rows,md5(coalesce(string_agg((${projection})::text,E'\\n' ORDER BY (${projection})::text COLLATE "C"),'')) AS digest FROM public."${table}" t`).join(" UNION ALL "))].sort((a,b)=>a.name.localeCompare(b.name));}
try{
 if(local)await db.unsafe("REVOKE ALL ON SCHEMA public FROM PUBLIC,anon,authenticated; REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC,anon,authenticated;");
 const result=await db.begin(async tx=>{
  await tx.unsafe("SET LOCAL TIME ZONE 'UTC'; SET LOCAL lock_timeout='10s'; SET LOCAL statement_timeout='120s';");
  await tx.unsafe("LOCK TABLE documents,document_lines,inventory_transactions,ledger_entries,payment_allocations,items,contacts,bank_accounts,cash_accounts,cheque_register,document_number_ledger,market_purchase_requests,expenses,contact_opening_balances IN SHARE ROW EXCLUSIVE MODE");
  const before=await fingerprints(tx);await tx.unsafe(migration);assert.deepEqual(await fingerprints(tx),before,"Any financial or stock change must roll back");
  const [integrity]=await tx`SELECT (SELECT count(*)::int FROM companies) AS companies,(SELECT count(*)::int FROM pg_constraint WHERE connamespace='public'::regnamespace AND NOT convalidated) AS invalid,(SELECT count(*)::int FROM contact_ledgers) AS ledgers`;
  assert.equal(integrity.companies,1);assert.equal(integrity.invalid,0);
  if(!local){await tx`INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('20261122000076','channel_ledgers_stock_conversion',${[migration]})`;await tx`INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES(${hash},${1795305600000})`;}
  return {preserved_tables:before,contact_ledgers:integrity.ledgers,all_financial_digests_match:true};
 });
 const report={verified_at:new Date().toISOString(),backup_id:proof.backup_id,migration_sha256:hash,target:local?"local rehearsal":"production",database,...result};
 writeFileSync(join(folder,local?"features-rehearsal.json":"features-applied.json"),JSON.stringify(report,null,2));
 if(local)writeFileSync("db-export/features-database.json",JSON.stringify({database,migration:"0076",production:false},null,2));
 console.log(JSON.stringify({target:report.target,database,ledgers:report.contact_ledgers,all_financial_digests_match:true}));
}finally{await db.end({timeout:5});}
