// Read-only live integrity check; no fixtures or mutations.
import assert from 'node:assert/strict';
import postgres from 'postgres';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,join,sep} from 'node:path';
import {createHash} from 'node:crypto';
const folder=resolve(process.argv[2]);assert.ok(folder.startsWith(resolve('db-export')+sep));
const target=new URL(process.env.DATABASE_URL_DIRECT);
assert.ok(decodeURIComponent(target.username)==='postgres.gvneuhadkktmhoxaazzg');
target.port='6543';
const db=postgres(target.toString(),{max:1,prepare:false,ssl:'require',connect_timeout:20,onnotice:()=>{}});
try{
 const [result]=await db`SELECT
  (SELECT count(*)::int FROM companies) AS companies,
  (SELECT name FROM companies LIMIT 1) AS company,
  (SELECT count(*)::int FROM documents) AS documents,
  (SELECT count(*)::int FROM items) AS products,
  (SELECT count(*)::int FROM contacts) AS contacts,
  (SELECT count(*)::int FROM contact_ledgers) AS contact_ledgers,
  (SELECT count(*)::int FROM auth.users) AS auth_users,
  (SELECT count(*)::int FROM pg_constraint WHERE connamespace='public'::regnamespace AND NOT convalidated) AS invalid_constraints,
  (SELECT count(*)::int FROM documents WHERE sale_type IS NULL) AS untagged_documents,
  (SELECT count(*)::int FROM user_roles ur WHERE NOT EXISTS(SELECT 1 FROM user_company_access uc WHERE uc.user_id=ur.user_id)) AS missing_memberships,
  (SELECT count(*)::int FROM pg_trigger WHERE tgname IN ('erp_closed_document','erp_closed_entry','erp_contact_ledger') AND NOT tgisinternal) AS ledger_triggers,
  (SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1) AS latest_migration_hash,
  (SELECT count(*)::int FROM supabase_migrations.schema_migrations WHERE version='20261122000076') AS supabase_migration`;
 assert.equal(result.companies,1);assert.equal(result.company,'Royal Hardware');assert.equal(result.invalid_constraints,0);assert.equal(result.untagged_documents,0);assert.equal(result.missing_memberships,0);assert.equal(result.ledger_triggers,3);assert.equal(result.supabase_migration,1);
 assert.equal(result.latest_migration_hash,createHash('sha256').update(readFileSync('drizzle/0076_channel_ledgers_stock_conversion.sql')).digest('hex'));
 const proof={verified_at:new Date().toISOString(),production:true,read_only:true,...result};
 writeFileSync(join(folder,'production-postconditions.json'),JSON.stringify(proof,null,2));console.log(JSON.stringify(proof));
}finally{await db.end({timeout:5});}
