// Restore legacy M52 ownership to the existing M52 channel, never financial values.
// Rehearse first: node --env-file=.env scripts/repair-m52-channel.mjs --local <fresh-backup-folder>
// Then apply:    node --env-file=.env scripts/repair-m52-channel.mjs --apply <fresh-backup-folder>
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {readFileSync, writeFileSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {pathToFileURL} from 'node:url';
import postgres from 'postgres';

const hash = value => createHash('sha256').update(value).digest('hex');
const quote = value => '"' + value.replaceAll('"', '""') + '"';
const byName = rows => [...rows].sort((a, b) => a.name.localeCompare(b.name));

export async function financialFingerprints(tx, ids) {
  // Every other document, including its channel and revision timestamp, is immutable.
  const idList = ids.map(id => { assert.match(id, /^[a-f0-9-]{36}$/); return `'${id}'::uuid`; }).join(',');
  const projection = `CASE WHEN t.id IN (${idList}) THEN to_jsonb(t)-'sale_type' ELSE to_jsonb(t) END`;
  // Expand dynamic identifiers on the server so the request itself stays small.
  return byName(await tx`SELECT s.tablename AS name,x.rows,x.digest FROM pg_tables s
    CROSS JOIN LATERAL XMLTABLE('/table/row' PASSING query_to_xml(format(
      'SELECT count(*)::int AS rows,md5(coalesce(string_agg((%1$s)::text,chr(10) ORDER BY (%1$s)::text COLLATE "C"),'''')) AS digest FROM public.%2$I t',
      CASE WHEN s.tablename='documents' THEN ${projection}::text ELSE 'to_jsonb(t)' END,s.tablename),false,false,'')
      COLUMNS rows int PATH 'rows',digest text PATH 'digest') x
    WHERE s.schemaname='public' AND s.tablename NOT IN ('audit_logs','cache_revisions','consolidation_history','contact_ledgers','contact_opening_balances')`);
}

export async function repairM52Channel(tx, evidence) {
  assert.equal(evidence.allBackupTableDigestsMatch, true);
  assert.equal(evidence.company.name.toLowerCase(), 'm52');
  assert.ok(evidence.documents.length > 0);
  const ids = evidence.documents.map(row => row.original.id);
  assert.equal(new Set(ids).size, ids.length);
  const companies = await tx`SELECT source_id,target_id FROM consolidation_history
    WHERE kind='company' AND lower(original->>'name')='m52'`;
  assert.equal(companies.length, 1, 'M52 company ownership must be unambiguous');
  assert.equal(companies[0].source_id, evidence.company.id);
  const companyId = companies[0].target_id;
  const channels = await tx`SELECT id FROM sales_channels WHERE lower(trim(name))='m52' AND is_active`;
  assert.equal(channels.length, 1, 'Use the existing active M52 channel; never guess or create a duplicate');
  const channelId = channels[0].id;
  const history = await tx`SELECT source_id,original FROM consolidation_history
    WHERE kind='document ownership' AND original->>'company_id'=${evidence.company.id} ORDER BY source_id`;
  assert.deepEqual(history.map(row => row.source_id).sort(), [...ids].sort(), 'Backup ownership and saved consolidation ownership must agree exactly');
  const originals = new Map(evidence.documents.map(row => [row.original.id, row.original]));
  for (const row of history) assert.deepEqual(row.original, originals.get(row.source_id), `Backup ownership mismatch for ${row.source_id}`);
  const current = await tx`SELECT id,company_id,contact_id,sale_type FROM documents WHERE id IN ${tx(ids)} ORDER BY id`;
  assert.equal(current.length, ids.length, 'A legacy M52 document is missing; stop instead of recreating it');
  assert.ok(current.every(row => row.company_id === companyId), 'Unexpected current company');
  const balances = await tx`SELECT d.contact_id,sum(le.debit)::text AS debit,sum(le.credit)::text AS credit,
    sum(le.debit-le.credit)::text AS balance,count(*)::int AS entries FROM documents d JOIN ledger_entries le ON le.document_id=d.id
    WHERE d.id IN ${tx(ids)} AND d.status='posted' GROUP BY d.contact_id ORDER BY d.contact_id`;
  assert.deepEqual([...balances], evidence.balances, 'M52 financial balances differ from the old backup; investigate before moving them');
  const [crossAllocation] = await tx`SELECT count(*)::int AS count FROM payment_allocations
    WHERE (payment_document_id IN ${tx(ids)}) <> (invoice_document_id IN ${tx(ids)})`;
  assert.equal(crossAllocation.count, 0, 'A payment crosses original company ownership; investigate before changing channels');
  const [linked] = await tx`SELECT count(*)::int AS count FROM documents child JOIN documents parent ON parent.id=child.source_document_id
    WHERE (child.id IN ${tx(ids)}) <> (parent.id IN ${tx(ids)})`;
  assert.equal(linked.count, 0, 'A related document crosses original company ownership; investigate its channel first');

  const before = await financialFingerprints(tx, ids);
  const preserved = quote(`m52_preserved_${randomUUID().replaceAll('-','')}`);
  await tx.unsafe(`CREATE TEMP TABLE ${preserved} ON COMMIT DROP AS
    SELECT 'audit'::text AS kind,id,to_jsonb(a) AS original FROM audit_logs a
    UNION ALL SELECT 'history',id,to_jsonb(h) FROM consolidation_history h`);
  const originalLedgers = await tx`SELECT * FROM contact_ledgers ORDER BY company_id,contact_id,channel_id`;
  const originalPointers = await tx`SELECT * FROM contact_opening_balances ORDER BY document_id`;
  const revisions = await tx`SELECT name,version::text FROM cache_revisions ORDER BY name`;
  const changed = current.filter(row => row.sale_type !== channelId);
  const contacts = [...new Set(current.map(row => row.contact_id).filter(Boolean))];

  if (changed.length) {
    // Archive exact previous records before the batched update. No financial row is deleted.
    await tx`INSERT INTO consolidation_history(kind,source_id,target_id,original)
      SELECT 'M52 channel correction',d.id::text,${channelId},to_jsonb(d) FROM documents d
      WHERE d.id IN ${tx(ids)} AND d.sale_type<>${channelId}`;
    await tx`INSERT INTO consolidation_history(kind,source_id,target_id,original)
      SELECT 'M52 opening pointer correction',b.document_id::text,${channelId},to_jsonb(b)
      FROM contact_opening_balances b WHERE b.document_id IN ${tx(ids)} AND b.channel_id<>${channelId}`;
    await tx`DELETE FROM contact_opening_balances WHERE document_id IN ${tx(ids)} AND channel_id<>${channelId}`;
    await tx`UPDATE documents SET sale_type=${channelId} WHERE id IN ${tx(ids)} AND sale_type<>${channelId}`;
    await tx`UPDATE expenses SET sale_type=${channelId} WHERE document_id IN ${tx(ids)} AND sale_type<>${channelId}`;
    // The document trigger creates M52 ledgers. Explicit insertion also covers historical
    // posted entries whose old document type no longer participates in that trigger.
    await tx`INSERT INTO contact_ledgers(company_id,contact_id,channel_id)
      SELECT DISTINCT d.company_id,d.contact_id,${channelId} FROM documents d
      WHERE d.id IN ${tx(ids)} AND d.contact_id IS NOT NULL AND EXISTS(SELECT 1 FROM ledger_entries le WHERE le.document_id=d.id)
      ON CONFLICT(company_id,contact_id,channel_id) DO UPDATE SET is_active=true`;
    // Rebuild missing lookup pointers, including the M52 opening archived by consolidation.
    // Existing pointers for other channels win; their underlying opening documents stay intact.
    await tx`INSERT INTO contact_opening_balances(company_id,contact_id,channel_id,document_id,updated_at)
      SELECT DISTINCT ON(d.company_id,d.contact_id,d.sale_type) d.company_id,d.contact_id,d.sale_type,d.id,
        coalesce((SELECT (h.original->>'updated_at')::timestamptz FROM consolidation_history h
          WHERE h.source_id=d.id::text AND h.kind IN ('opening balance index','M52 opening pointer correction')
          ORDER BY h.created_at LIMIT 1),d.updated_at,d.created_at,now())
      FROM documents d JOIN document_types dt ON dt.id=d.document_type_id
      WHERE d.company_id=${companyId} AND d.contact_id IN ${tx(contacts)} AND dt.code='OPENING_BALANCE'
        AND d.status='posted' AND d.ledger_closed_at IS NULL
      ORDER BY d.company_id,d.contact_id,d.sale_type,d.created_at,d.id
      ON CONFLICT DO NOTHING`;
    await tx`UPDATE contact_ledgers cl SET is_active=false WHERE cl.company_id=${companyId}
      AND cl.contact_id IN ${tx(contacts)} AND cl.channel_id<>${channelId} AND cl.is_active
      AND EXISTS(SELECT 1 FROM consolidation_history h WHERE h.kind='M52 channel correction'
        AND h.original->>'contact_id'=cl.contact_id::text AND h.original->>'sale_type'=cl.channel_id)
      AND NOT EXISTS(SELECT 1 FROM documents d WHERE d.company_id=cl.company_id AND d.contact_id=cl.contact_id AND d.sale_type=cl.channel_id)`;
    await tx`INSERT INTO audit_logs(company_id,user_name,action,entity,entity_id,summary,detail)
      SELECT d.company_id,'M52 backup reconciliation','update','document',d.id,'Restored '||d.number||' to M52 channel',
        jsonb_build_object('original_company','M52','backup_id',${evidence.backupId}::text,'previous_channel',h.original->>'sale_type',
          'channel_id',${channelId}::text,'preserved','All financial values, entries, allocations, cash/bank balances and stock')::text
      FROM documents d JOIN consolidation_history h ON h.source_id=d.id::text AND h.kind='M52 channel correction'
      WHERE d.id IN ${tx(changed.map(row => row.id))}`;
    // Durable invalidation is observed by every application instance and Redis generation.
    await tx`UPDATE cache_revisions SET version=version+1`;
  }

  assert.deepEqual(await financialFingerprints(tx, ids), before, 'Unexpected financial or unrelated record change; roll back');
  const [changedHistory] = await tx.unsafe(`SELECT count(*)::int AS count FROM ${preserved} p
    LEFT JOIN audit_logs a ON p.kind='audit' AND a.id=p.id
    LEFT JOIN consolidation_history h ON p.kind='history' AND h.id=p.id
    WHERE p.original IS DISTINCT FROM CASE WHEN p.kind='audit' THEN to_jsonb(a) ELSE to_jsonb(h) END`);
  assert.equal(changedHistory.count,0,'Old audit and consolidation history must stay intact');
  const afterPointers = await tx`SELECT * FROM contact_opening_balances ORDER BY document_id`;
  for (const pointer of originalPointers.filter(row => !ids.includes(row.document_id))) {
    assert.deepEqual(afterPointers.find(row => row.document_id === pointer.document_id), pointer, 'An unrelated opening pointer changed');
  }
  const afterLedgers = await tx`SELECT * FROM contact_ledgers ORDER BY company_id,contact_id,channel_id`;
  for (const ledger of originalLedgers) {
    const actual = afterLedgers.find(row => row.company_id === ledger.company_id && row.contact_id === ledger.contact_id && row.channel_id === ledger.channel_id);
    assert.ok(actual, 'No existing contact ledger can be deleted');
    assert.deepEqual({...actual, is_active:ledger.is_active}, ledger, 'Ledger history or closing checkpoint changed');
    if (actual.is_active !== ledger.is_active) assert.ok(contacts.includes(ledger.contact_id), 'An unrelated ledger was deactivated');
  }
  const [remaining] = await tx`SELECT count(*)::int AS count FROM documents WHERE id IN ${tx(ids)} AND sale_type<>${channelId}`;
  assert.equal(remaining.count, 0);
  const [pointerErrors] = await tx`SELECT count(*)::int AS count FROM contact_opening_balances b JOIN documents d ON d.id=b.document_id
    WHERE b.company_id<>d.company_id OR b.contact_id<>d.contact_id OR b.channel_id<>d.sale_type`;
  assert.equal(pointerErrors.count, 0, 'Opening pointers must agree with their documents');
  const restoredBalances = await tx`SELECT d.contact_id,sum(le.debit)::text AS debit,sum(le.credit)::text AS credit,
    sum(le.debit-le.credit)::text AS balance,count(*)::int AS entries FROM documents d JOIN ledger_entries le ON le.document_id=d.id
    WHERE d.company_id=${companyId} AND d.sale_type=${channelId} AND d.status='posted' GROUP BY d.contact_id ORDER BY d.contact_id`;
  assert.deepEqual([...restoredBalances], evidence.balances, 'Every restored M52 ledger must match the old backup');
  const [missingOpening] = await tx`SELECT count(*)::int AS count FROM documents d JOIN document_types dt ON dt.id=d.document_type_id
    WHERE d.id IN ${tx(ids)} AND dt.code='OPENING_BALANCE' AND d.status='posted' AND d.ledger_closed_at IS NULL
    AND NOT EXISTS(SELECT 1 FROM contact_opening_balances b WHERE b.document_id=d.id AND b.channel_id=${channelId})`;
  assert.equal(missingOpening.count, 0, 'Restore every original M52 opening lookup');
  if (changed.length) {
    const afterRevisions = await tx`SELECT name,version::text FROM cache_revisions ORDER BY name`;
    assert.ok(revisions.every(row => BigInt(afterRevisions.find(after => after.name === row.name).version) > BigInt(row.version)), 'Every shared cache must be invalidated');
  }
  const types = await tx`SELECT dt.code,count(*)::int AS documents,sum(d.grand_total)::text AS total
    FROM documents d JOIN document_types dt ON dt.id=d.document_type_id WHERE d.id IN ${tx(ids)} GROUP BY dt.code ORDER BY dt.code`;
  return {channelId,companyId,documents:ids.length,changedDocuments:changed.length,contactLedgers:evidence.balances.length,
    openingPointers:afterPointers.filter(row => ids.includes(row.document_id)).length,types:[...types],
    preservedTables:before,allFinancialFingerprintsMatch:true,allLedgerBalancesMatchBackup:true,allOpeningPointersMatch:true};
}

async function main() {
  const mode = process.argv[2]; assert.ok(['--local','--apply'].includes(mode), 'Choose --local or --apply');
  const folder = resolve(process.argv[3]);
  assert.ok(folder.toLowerCase().startsWith(resolve('db-export').toLowerCase()+'\\'));
  const proof = JSON.parse(readFileSync(join(folder,'restore-verification.json'),'utf8'));
  assert.equal(proof.all_table_digests_match,true); assert.equal(proof.all_constraints_valid,true);
  assert.ok(Date.now()-Date.parse(proof.verified_at)<86400000, 'Use a fresh restored backup');
  const evidenceText = readFileSync('db-export/m52-original-evidence.json','utf8');
  const evidence = JSON.parse(evidenceText);
  const scriptHash = hash(readFileSync(new URL(import.meta.url)));
  const evidenceHash = hash(evidenceText);
  const local = mode === '--local';
  let database;
  if (local) {
    assert.match(proof.database,/^restore_\d+$/);
    database = `m52_repair_${Date.now()}`;
    const admin = postgres('postgresql://restore_verify@127.0.0.1:55474/postgres',{max:1,onnotice:()=>{}});
    try { await admin.unsafe(`CREATE DATABASE ${quote(database)} TEMPLATE ${quote(proof.database)}`); }
    finally { await admin.end({timeout:2}); }
  } else {
    const rehearsal = JSON.parse(readFileSync(join(folder,'m52-rehearsal.json'),'utf8'));
    assert.equal(rehearsal.scriptHash,scriptHash); assert.equal(rehearsal.evidenceHash,evidenceHash);
    assert.equal(rehearsal.allFinancialFingerprintsMatch,true);
    assert.equal(rehearsal.idempotent,true);
    const target = new URL(process.env.DATABASE_URL_DIRECT);
    assert.ok(target.hostname==='db.gvneuhadkktmhoxaazzg.supabase.co'||decodeURIComponent(target.username)==='postgres.gvneuhadkktmhoxaazzg');
  }
  const db = postgres(local ? `postgresql://restore_verify@127.0.0.1:55474/${database}` : process.env.DATABASE_URL_DIRECT,
    {max:1,ssl:local?false:'require',connect_timeout:20,onnotice:()=>{}});
  try {
    const result = await db.begin(async tx => {
      await tx`SET LOCAL TIME ZONE 'UTC'`;
      await tx`SET LOCAL lock_timeout='10s'`;
      await tx`SET LOCAL statement_timeout='120s'`;
      await tx.unsafe('LOCK TABLE documents,document_types,document_lines,ledger_entries,payment_allocations,contact_ledgers,contact_opening_balances,consolidation_history,sales_channels,expenses,cash_accounts,bank_accounts,inventory_transactions,audit_logs IN SHARE ROW EXCLUSIVE MODE');
      const result = await repairM52Channel(tx,evidence);
      if (local) {
        const second = await repairM52Channel(tx,evidence);
        assert.equal(second.changedDocuments,0,'Replaying must be a no-op');
        result.idempotent = true;
      }
      return result;
    });
    const report = {verifiedAt:new Date().toISOString(),target:local?'local rehearsal':'production',database,
      backupId:proof.backup_id,originalBackupId:evidence.backupId,scriptHash,evidenceHash,...result};
    writeFileSync(join(folder,local?'m52-rehearsal.json':'m52-applied.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report));
  } finally { await db.end({timeout:3}); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error instanceof assert.AssertionError ? error : {code:error.code,message:error.message}); process.exitCode=1; });
}
