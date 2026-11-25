// Integration check against an isolated loopback clone; every test write rolls back.
// node scripts/m52-channel-repair.check.mjs <restore_database>
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import postgres from 'postgres';
import {repairM52Channel} from './repair-m52-channel.mjs';

const source = process.argv[2];
assert.match(source, /^restore_\d+$/);
const name = `m52_repair_check_${Date.now()}`;
const admin = postgres('postgresql://restore_verify@127.0.0.1:55474/postgres',{max:1,onnotice:()=>{}});
try { await admin.unsafe(`CREATE DATABASE "${name}" TEMPLATE "${source}"`); }
finally { await admin.end({timeout:2}); }
const db = postgres(`postgresql://restore_verify@127.0.0.1:55474/${name}`,{max:1,onnotice:()=>{}});
const evidence = JSON.parse(readFileSync('db-export/m52-original-evidence.json','utf8'));
const rollback = new Error('Expected check rollback');
async function allTables(tx) {
  const tables = await tx`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`;
  return [...await tx.unsafe(tables.map(({tablename}) => `SELECT '${tablename}' AS name,count(*)::int AS rows,
    md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY to_jsonb(t)::text COLLATE "C"),'')) AS digest
    FROM public."${tablename}" t`).join(' UNION ALL '))].sort((a,b)=>a.name.localeCompare(b.name));
}
try {
  try { await db.begin(async tx => {
    await tx`SET LOCAL TIME ZONE 'UTC'`;
    await tx`SET LOCAL statement_timeout='60s'`;
    // The older recovery copy can predate the owner's M52 channel creation.
    await tx`INSERT INTO sales_channels(id,name) SELECT 'm52-reconciliation-check','M52'
      WHERE NOT EXISTS(SELECT 1 FROM sales_channels WHERE lower(trim(name))='m52')`;
    const untouched = await allTables(tx);
    const wrongCompany = structuredClone(evidence); wrongCompany.company.id='00000000-0000-0000-0000-000000000000';
    await assert.rejects(()=>repairM52Channel(tx,wrongCompany),assert.AssertionError);
    const wrongAmount = structuredClone(evidence); wrongAmount.balances[0].balance='123.45';
    await assert.rejects(()=>repairM52Channel(tx,wrongAmount),/financial balances differ/);
    const wrongOwnership = structuredClone(evidence); wrongOwnership.documents[0].original.number='incorrect-backup-number';
    await assert.rejects(()=>repairM52Channel(tx,wrongOwnership),/Backup ownership mismatch/);
    await assert.rejects(()=>tx.savepoint(async nested => {
      await nested`UPDATE sales_channels SET is_active=false WHERE lower(trim(name))='m52'`;
      await repairM52Channel(nested,evidence);
    }),/existing active M52 channel/);
    await assert.rejects(()=>tx.savepoint(async nested => {
      const ids=evidence.documents.map(row=>row.original.id);
      const [payment]=await nested`SELECT pa.id FROM payment_allocations pa WHERE pa.payment_document_id IN ${nested(ids)} LIMIT 1`;
      const [invoice]=await nested`SELECT d.id FROM documents d JOIN document_types dt ON dt.id=d.document_type_id
        WHERE d.id NOT IN ${nested(ids)} AND dt.code='SALES_INVOICE' LIMIT 1`;
      assert.ok(payment&&invoice);
      await nested`UPDATE payment_allocations SET invoice_document_id=${invoice.id} WHERE id=${payment.id}`;
      await repairM52Channel(nested,evidence);
    }),/payment crosses original company ownership/);
    assert.deepEqual(await allTables(tx),untouched,'Refused repairs must leave every table intact');
    const first = await repairM52Channel(tx,evidence);
    assert.equal(first.changedDocuments,evidence.documents.length);
    assert.equal(first.contactLedgers,13);
    assert.equal(first.openingPointers,2);
    const repaired = await allTables(tx);
    const second = await repairM52Channel(tx,evidence);
    assert.equal(second.changedDocuments,0);
    assert.deepEqual(await allTables(tx),repaired,'A replay must not change any table, including audit, history, pointers or cache revisions');
    throw rollback;
  }); } catch (error) { if(error!==rollback) throw error; }
  console.log('M52 backup ownership, balances, refusal without writes, cross-company allocation protection, 99-document repair, two opening pointers, all-table preservation and replay checks passed (rolled back).');
} finally { await db.end({timeout:2}); }
