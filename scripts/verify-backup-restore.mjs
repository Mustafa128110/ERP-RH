// Restore only into a newly created loopback database, never a hosted target.
// node --env-file=.env scripts/verify-backup-restore.mjs db-export/verified-...
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import postgres from 'postgres';
const folder=resolve(process.argv[2]);
assert.ok(folder.startsWith(resolve('db-export')+'\\'),'Use a backup in the workspace');
const extract=join(folder,'restored-archive');mkdirSync(extract,{recursive:true});
const database=`restore_${Date.now()}`;
const url=`postgresql://restore_verify@127.0.0.1:55474/${database}`;
const admin=postgres('postgresql://restore_verify@127.0.0.1:55474/postgres',{max:1,onnotice:()=>{}});
function run(exe,args,options={}){
 const result=spawnSync(exe,args,{windowsHide:true,encoding:'utf8',maxBuffer:20*1024*1024,...options});
 if(result.status!==0) { writeFileSync(join(folder,'restore-error.log'),result.stderr||'');throw new Error('Local restore utility failed; see ignored restore-error.log'); }
 return result.stdout;
}
const sha=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
const zip=resolve('db-export/restore-tools/7zip/x64/7za.exe');
const archive=join(folder,'latest.zip');
assert.equal(sha(archive),readFileSync(join(folder,'latest.zip.sha256'),'utf8').trim());
run(zip,['x','-y',`-p${process.env.BACKUP_ARCHIVE_PASSWORD}`,`-o${extract}`,archive]);
const manifest=JSON.parse(readFileSync(join(extract,'manifest.json'),'utf8'));
for(const [file,hash] of Object.entries(manifest.files)) { assert.equal(resolve(extract,file),join(extract,file));assert.equal(sha(join(extract,file)),hash,file); }
try {
 await admin.unsafe(`CREATE DATABASE "${database}"`);
 const local=postgres(url,{max:1,onnotice:()=>{}});
 try {
  await local`SET TIME ZONE 'UTC'`;
  await local.unsafe('CREATE SCHEMA auth; CREATE SCHEMA drizzle; CREATE SCHEMA supabase_migrations;');
  // Public business schema and Supabase auth data are portable. Provider-owned
  // realtime/storage/vault services must be provisioned by Supabase separately.
  run(resolve('db-export/restore-tools/pgsql/bin/pg_restore.exe'),['--exit-on-error','--no-owner','--no-privileges','--schema=public','--schema=auth','--schema=drizzle','--schema=supabase_migrations',`--dbname=${url}`,join(extract,'snapshot.dump')]);
  const expected=JSON.parse(readFileSync(join(extract,'contents.json'),'utf8'));
  const query=expected.map(({name})=>`SELECT '${name}' AS name,count(*)::text AS rows,md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY to_jsonb(t)::text COLLATE "C"),'')) AS digest FROM public."${name.replaceAll('"','""')}" t`).join(' UNION ALL ');
  const actual=await local.unsafe(query);
  assert.deepEqual([...actual],expected,'Every ERP table must match the exact backup snapshot');
  const [constraints]=await local`SELECT count(*)::int AS invalid FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public' AND NOT convalidated`;
  assert.equal(constraints.invalid,0);
  const [auth]=await local`SELECT count(*)::int AS users FROM auth.users`;
  const result={verified_at:new Date().toISOString(),backup_id:manifest.backup_id,database,archive_sha256:sha(archive),tables:expected.length,rows:expected.reduce((sum,t)=>sum+Number(t.rows),0),all_table_digests_match:true,all_constraints_valid:true,auth_users:auth.users,scope:'ERP public tables, auth, migration history; provider services require Supabase provisioning'};
  writeFileSync(join(folder,'restore-verification.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 } finally {await local.end()}
} finally {await admin.end()}
