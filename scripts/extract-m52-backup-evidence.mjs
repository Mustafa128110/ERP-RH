// Read and verify the old, already-restored local backup. Never writes to the ERP.
// node scripts/extract-m52-backup-evidence.mjs db-export/verified-20261121T132324Z
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import postgres from 'postgres';

const folder=resolve(process.argv[2]);
assert.ok(folder.toLowerCase().startsWith(resolve('db-export').toLowerCase()+'\\'));
const proof=JSON.parse(readFileSync(join(folder,'restore-verification.json'),'utf8'));
const manifest=JSON.parse(readFileSync(join(folder,'manifest.json'),'utf8'));
assert.equal(proof.all_table_digests_match,true);
assert.equal(proof.all_constraints_valid,true);
assert.equal(proof.backup_id,manifest.backup_id);
assert.match(proof.database,/^restore_\d+$/);
for(const file of ['snapshot.dump','contents.json']) {
  assert.equal(createHash('sha256').update(readFileSync(join(folder,file))).digest('hex'),manifest.files[file]);
}
const expected=JSON.parse(readFileSync(join(folder,'contents.json'),'utf8'));
for(const table of expected)assert.match(table.name,/^[a-z_][a-z0-9_]*$/);
const db=postgres(`postgresql://restore_verify@127.0.0.1:55474/${proof.database}`,{max:1,onnotice:()=>{}});
try {
  await db.begin('isolation level repeatable read read only',async tx=>{
    await tx`SET LOCAL TIME ZONE 'UTC'`;
    const query=expected.map(({name})=>`SELECT '${name}' AS name,count(*)::text AS rows,
      md5(coalesce(string_agg(to_jsonb(t)::text,chr(10) ORDER BY to_jsonb(t)::text COLLATE "C"),'')) AS digest FROM public."${name}" t`).join(' UNION ALL ');
    const byName=rows=>[...rows].sort((a,b)=>a.name.localeCompare(b.name));
    assert.deepEqual(byName(await tx.unsafe(query)),byName(expected),'The restored backup must still match every original table digest');
    const companies=await tx`SELECT id,name FROM companies WHERE lower(trim(name))='m52'`;
    assert.equal(companies.length,1,'Select a backup from before company consolidation');
    const company=companies[0];
    const documents=await tx`SELECT to_jsonb(d) AS original,dt.code FROM documents d JOIN document_types dt ON dt.id=d.document_type_id
      WHERE d.company_id=${company.id} ORDER BY d.id`;
    const balances=await tx`SELECT d.contact_id,sum(le.debit)::text AS debit,sum(le.credit)::text AS credit,
      sum(le.debit-le.credit)::text AS balance,count(*)::int AS entries FROM documents d JOIN ledger_entries le ON le.document_id=d.id
      WHERE d.company_id=${company.id} AND d.status='posted' GROUP BY d.contact_id ORDER BY d.contact_id`;
    const evidence={backupFolder:folder,backupId:manifest.backup_id,archiveSha256:proof.archive_sha256,
      allBackupTableDigestsMatch:true,company,documents:[...documents],balances:[...balances]};
    writeFileSync('db-export/m52-original-evidence.json',JSON.stringify(evidence,null,2));
    console.log(JSON.stringify({verifiedBackup:manifest.backup_id,tables:expected.length,documents:documents.length,ledgers:balances.length}));
  });
} finally {await db.end({timeout:2});}
