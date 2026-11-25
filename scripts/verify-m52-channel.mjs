// Independent, read-only verification after the repair transaction commits.
// node --env-file=.env scripts/verify-m52-channel.mjs <fresh-backup-folder>
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import postgres from 'postgres';
import {financialFingerprints} from './repair-m52-channel.mjs';

const folder=resolve(process.argv[2]);
assert.ok(folder.toLowerCase().startsWith(resolve('db-export').toLowerCase()+'\\'));
const applied=JSON.parse(readFileSync(join(folder,'m52-applied.json'),'utf8'));
assert.equal(applied.target,'production');
const text=readFileSync('db-export/m52-original-evidence.json','utf8');
assert.equal(createHash('sha256').update(text).digest('hex'),applied.evidenceHash);
const evidence=JSON.parse(text),ids=evidence.documents.map(row=>row.original.id);
const target=new URL(process.env.DATABASE_URL_DIRECT);
assert.ok(target.hostname==='db.gvneuhadkktmhoxaazzg.supabase.co'||decodeURIComponent(target.username)==='postgres.gvneuhadkktmhoxaazzg');
const db=postgres(target.toString(),{max:1,ssl:'require',connect_timeout:20,onnotice:()=>{}});
try {
  const report=await db.begin('isolation level repeatable read read only',async tx=>{
    await tx`SET LOCAL TIME ZONE 'UTC'`;
    await tx`SET LOCAL statement_timeout='120s'`;
    assert.deepEqual(await financialFingerprints(tx,ids),applied.preservedTables,'Committed financial and unrelated records must match the pre-repair fingerprints');
    const [documents]=await tx`SELECT count(*)::int AS count,count(*) FILTER(WHERE id IN ${tx(ids)})::int AS original
      FROM documents WHERE sale_type=${applied.channelId}`;
    assert.deepEqual(documents,{count:ids.length,original:ids.length});
    const balances=await tx`SELECT d.contact_id,sum(le.debit)::text AS debit,sum(le.credit)::text AS credit,
      sum(le.debit-le.credit)::text AS balance,count(*)::int AS entries FROM documents d JOIN ledger_entries le ON le.document_id=d.id
      WHERE d.company_id=${applied.companyId} AND d.sale_type=${applied.channelId} AND d.status='posted'
      GROUP BY d.contact_id ORDER BY d.contact_id`;
    assert.deepEqual([...balances],evidence.balances);
    // Draft/cancelled legacy documents can also have empty ledger registrations.
    // Compare financial ledgers with the backup's posted ledger entries.
    const [ledgers]=await tx`SELECT count(*)::int AS count FROM contact_ledgers cl
      WHERE company_id=${applied.companyId} AND channel_id=${applied.channelId} AND is_active
      AND EXISTS(SELECT 1 FROM documents d JOIN ledger_entries le ON le.document_id=d.id
        WHERE d.company_id=cl.company_id AND d.contact_id=cl.contact_id AND d.sale_type=cl.channel_id AND d.status='posted')`;
    assert.equal(ledgers.count,evidence.balances.length);
    const [pointers]=await tx`SELECT count(*)::int AS count FROM contact_opening_balances WHERE channel_id=${applied.channelId}`;
    assert.equal(pointers.count,applied.openingPointers);
    const [audit]=await tx`SELECT count(*)::int AS count FROM audit_logs WHERE entity_id IN ${tx(ids)}
      AND user_name='M52 backup reconciliation' AND summary LIKE 'Restored % to M52 channel'`;
    assert.equal(audit.count,applied.changedDocuments);
    const [invalid]=await tx`SELECT count(*)::int AS count FROM pg_constraint WHERE connamespace='public'::regnamespace AND NOT convalidated`;
    assert.equal(invalid.count,0);
    return {verifiedAt:new Date().toISOString(),target:'production',documents:documents.count,contactLedgers:ledgers.count,
      openingPointers:pointers.count,auditEntries:audit.count,allCommittedFinancialFingerprintsMatch:true,
      allM52BalancesMatchOldBackup:true,allConstraintsValid:true};
  });
  writeFileSync(join(folder,'m52-postconditions.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
} finally {await db.end({timeout:3});}
