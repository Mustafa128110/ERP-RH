// Rehearse against a restored local backup first. Never prints connection credentials.
// node --env-file=.env scripts/consolidate-company.mjs --local db-export/verified-...
// node --env-file=.env scripts/consolidate-company.mjs --apply db-export/verified-...
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import postgres from 'postgres';

const local=process.argv[2]==='--local';
assert.ok(local||process.argv[2]==='--apply','Choose --local or --apply');
const folder=resolve(process.argv[3]);
assert.ok(folder.startsWith(resolve('db-export')+'\\'));
const proof=JSON.parse(readFileSync(join(folder,'restore-verification.json'),'utf8'));
assert.equal(proof.all_table_digests_match,true);
assert.equal(proof.all_constraints_valid,true);
assert.ok(Date.now()-Date.parse(proof.verified_at)<86400000,'A fresh verified backup is required');
const migration=readFileSync('drizzle/0075_single_company_channels.sql','utf8');
assert.equal(migration,readFileSync('supabase/migrations/20261121000075_single_company_channels.sql','utf8'));
const migrationHash=createHash('sha256').update(migration).digest('hex');
if(!local){
 const rehearsal=JSON.parse(readFileSync(join(folder,'consolidation-rehearsal.json'),'utf8'));
 assert.equal(rehearsal.migration_sha256,migrationHash,'Rehearse this exact migration first');
 assert.equal(rehearsal.all_preservation_checks_passed,true);
}
const url=local?`postgresql://restore_verify@127.0.0.1:55474/${proof.database}`:process.env.DATABASE_URL_DIRECT;
const target=new URL(url);
if(!local)assert.ok(target.hostname==='db.gvneuhadkktmhoxaazzg.supabase.co'||decodeURIComponent(target.username)==='postgres.gvneuhadkktmhoxaazzg','Unexpected production target');
const db=postgres(url,{max:1,ssl:local?false:'require',connect_timeout:20,onnotice:()=>{}});

// Fingerprint all immutable financial data, not just row counts or grand totals.
const stableTables={
 documents:"(to_jsonb(t)-'company_id'-'document_type_id'-'sale_type') || jsonb_build_object('sale_type',coalesce(t.sale_type::text,'counter'))",
 document_lines:"to_jsonb(t)-'company_id'-'item_id'",
 inventory_transactions:"to_jsonb(t)-'company_id'",
 ledger_entries:"to_jsonb(t)-'company_id'",
 payment_allocations:"to_jsonb(t)-'company_id'",
 document_number_ledger:"(to_jsonb(t)-'company_id'-'document_type_id') - (CASE WHEN t.document_id IS NULL THEN 'number' ELSE '__unchanged__' END)",
 contacts:"to_jsonb(t)-'company_id'",
 expenses:"to_jsonb(t)-'company_id'-'expense_category_id'",
 bank_accounts:"to_jsonb(t)-'company_id'",
 cash_accounts:"to_jsonb(t)-'company_id'-'name'",
 cheque_register:"to_jsonb(t)-'company_id'",
 market_purchase_requests:"to_jsonb(t)-'company_id'-'item_id'",
};
async function fingerprints(tx){
 const query=Object.entries(stableTables).map(([table,projection])=>`SELECT '${table}' AS name,count(*)::int AS rows,md5(coalesce(string_agg((${projection})::text,E'\\n' ORDER BY (${projection})::text COLLATE "C"),'')) AS digest FROM public."${table}" t`).join(' UNION ALL ');
 return [...await tx.unsafe(query)].sort((a,b)=>a.name.localeCompare(b.name));
}
async function stock(tx){
 return [...await tx`SELECT i.sku,dl.location_id,dl.unit_id,sum(it.movement*it.base_quantity)::text AS quantity,sum(it.movement*it.base_quantity*it.unit_cost)::text AS value
 FROM inventory_transactions it JOIN document_lines dl ON dl.id=it.document_line_id JOIN items i ON i.id=dl.item_id
 GROUP BY i.sku,dl.location_id,dl.unit_id ORDER BY i.sku,dl.location_id NULLS FIRST,dl.unit_id NULLS FIRST`];
}
try{
 if(local)await db.unsafe("DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF; IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF; END $$; REVOKE ALL ON SCHEMA public FROM PUBLIC,anon,authenticated; REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC,anon,authenticated;");
 const result=await db.begin(async tx=>{
  await tx`SET LOCAL lock_timeout='10s'`;
  await tx`SET LOCAL statement_timeout='120s'`;
  // The lock closes the gap between preservation snapshots and the migration.
  await tx.unsafe('LOCK TABLE companies,items,documents,document_lines,inventory_transactions,ledger_entries,payment_allocations,contacts,expenses,bank_accounts,cash_accounts,cheque_register,market_purchase_requests,document_number_ledger IN SHARE ROW EXCLUSIVE MODE');
  const before=await fingerprints(tx);
  const beforeStock=await stock(tx);
  const [{count:beforeProducts}]=await tx`SELECT count(*)::int AS count FROM items`;
  await tx.unsafe(migration);
  const after=await fingerprints(tx);
  assert.deepEqual(after,before,'Financial data or contact/account records changed unexpectedly; rolling back');
  assert.deepEqual(await stock(tx),beforeStock,'Consolidated stock quantity or valuation changed; rolling back');
  const companies=await tx`SELECT id,name FROM companies`;
  assert.equal(companies.length,1);assert.equal(companies[0].name,'Royal Hardware');
  const [{count:merged}]=await tx`SELECT count(*)::int AS count FROM consolidation_history WHERE kind='merged product'`;
  const [{count:afterProducts}]=await tx`SELECT count(*)::int AS count FROM items`;
  assert.equal(beforeProducts-afterProducts,merged);
  const [{invalid}]=await tx`SELECT count(*)::int AS invalid FROM pg_constraint WHERE connamespace='public'::regnamespace AND NOT convalidated`;
  assert.equal(invalid,0);
  const [{unassigned}]=await tx`SELECT count(*)::int AS unassigned FROM users u WHERE EXISTS(SELECT 1 FROM user_roles r WHERE r.user_id=u.id) AND NOT EXISTS(SELECT 1 FROM user_company_access a WHERE a.user_id=u.id)`;
  assert.equal(unassigned,0);
  if(!local){
   await tx`INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES ('20261121000075','single_company_channels',${[migration]})`;
   await tx`INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES (${migrationHash},${1795269600000})`;
  }
  return {company:companies[0].name,merged_products:merged,products:afterProducts,preserved_tables:after,stock_groups:beforeStock.length,all_preservation_checks_passed:true};
 });
 const report={verified_at:new Date().toISOString(),backup_id:proof.backup_id,migration_sha256:migrationHash,target:local?'local rehearsal':'production',...result};
 writeFileSync(join(folder,local?'consolidation-rehearsal.json':'consolidation-applied.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({target:report.target,company:report.company,products:report.products,merged_products:report.merged_products,all_preservation_checks_passed:true}));
}finally{await db.end({timeout:5})}
