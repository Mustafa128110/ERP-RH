// Local release backup. Credentials are read from .env by Node; never logged.
// Usage: node --env-file=.env scripts/create-verified-backup.mjs [--upload]
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import postgres from 'postgres';
const target = new URL(process.env.DATABASE_URL_DIRECT);
if (!target.username.includes('gvneuhadkktmhoxaazzg')) throw new Error('Expected ERP-System Singapore database');
const id = new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d+Z/,'Z');
const folder = resolve('db-export',`verified-${id}`);mkdirSync(folder,{recursive:true});
const pg = resolve('db-export/restore-tools/pgsql/bin');
const zip = resolve('db-export/restore-tools/7zip/x64/7za.exe');
const env = {...process.env,PGHOST:target.hostname,PGPORT:target.port||'5432',PGUSER:decodeURIComponent(target.username),PGPASSWORD:decodeURIComponent(target.password),PGDATABASE:target.pathname.slice(1),PGSSLMODE:'require'};
function run(exe,args,options={}) {
 const result=spawnSync(exe,args,{env,encoding:'utf8',maxBuffer:20*1024*1024,windowsHide:true,...options});
 if(result.status!==0) throw new Error(`${exe.split(/[\\/]/).pop()} failed (exit ${result.status}); backup has not replaced latest`);
 return result.stdout;
}
const sha=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
const sql=postgres(process.env.DATABASE_URL_DIRECT,{max:1,ssl:'require',onnotice:()=>{}});
try {
 await sql.begin('isolation level repeatable read read only',async tx=>{
  await tx`SET LOCAL TIME ZONE 'UTC'`;
  const [{snapshot}]=await tx`SELECT pg_export_snapshot() AS snapshot`;
  // Keep this transaction open until pg_dump has consumed its exported snapshot.
  run(join(pg,'pg_dump.exe'),['--format=custom','--no-owner','--no-privileges',`--snapshot=${snapshot}`,`--file=${join(folder,'snapshot.dump')}`]);
  const tables=await tx`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`;
  const fingerprint=tables.map(({tablename})=>`SELECT '${tablename}' AS name,count(*)::text AS rows,md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY to_jsonb(t)::text COLLATE "C"),'')) AS digest FROM public."${tablename.replaceAll('"','""')}" t`).join(' UNION ALL ');
  const contents=await tx.unsafe(fingerprint);
  writeFileSync(join(folder,'contents.json'),JSON.stringify(contents,null,2));
 });
 run(join(pg,'pg_restore.exe'),['--no-owner','--no-privileges','--schema-only',`--file=${join(folder,'schema.sql')}`,join(folder,'snapshot.dump')]);
 run(join(pg,'pg_restore.exe'),['--no-owner','--no-privileges','--data-only','--table=roles','--table=permissions','--table=role_permissions','--table=user_roles',`--file=${join(folder,'roles.sql')}`,join(folder,'snapshot.dump')]);
 const list=run(join(pg,'pg_restore.exe'),['--list',join(folder,'snapshot.dump')]);
 writeFileSync(join(folder,'data.list'),list.split('\n').filter(line=>!/^\d+; \d+ \d+ TABLE DATA public (roles|permissions|role_permissions|user_roles) /.test(line)).join('\n'));
 run(join(pg,'pg_restore.exe'),['--no-owner','--no-privileges','--data-only',`--use-list=${join(folder,'data.list')}`,`--file=${join(folder,'data.sql')}`,join(folder,'snapshot.dump')]);
 const files=Object.fromEntries(['snapshot.dump','schema.sql','roles.sql','data.sql','contents.json'].map(file=>[file,sha(join(folder,file))]));
 const manifest={backup_id:id,created_at_utc:new Date().toISOString(),project:'gvneuhadkktmhoxaazzg',role_scope:'ERP application roles and permissions',files};
 writeFileSync(join(folder,'manifest.json'),JSON.stringify(manifest,null,2));
 const archive=join(folder,'latest.zip');
 run(zip,['a','-tzip','-mem=AES256',`-p${process.env.BACKUP_ARCHIVE_PASSWORD}`,archive,...Object.keys(files),'manifest.json'],{cwd:folder});
 run(zip,['t',`-p${process.env.BACKUP_ARCHIVE_PASSWORD}`,archive]);
 const archiveSha=sha(archive);
 writeFileSync(join(folder,'latest.zip.sha256'),archiveSha+'\n');
 if(process.argv.includes('--upload')) {
  const endpoint=process.env.R2_ENDPOINT.replace(/\/$/,'');
  const bucket=process.env.R2_BUCKET;
  function r2(key,args) {
   const config=`url = ${JSON.stringify(`${endpoint}/${bucket}/${key}`)}\nuser = ${JSON.stringify(`${process.env.R2_ACCESS_KEY_ID}:${process.env.R2_SECRET_ACCESS_KEY}`)}\n`;
   return run('curl.exe',['--silent','--show-error','--fail','--aws-sigv4','aws:amz:auto:s3','--config','-',...args],{input:config});
  }
  const history=`erp-backups/history/${id}.zip`;
  r2(history,['--upload-file',archive,'--header',`x-amz-meta-sha256: ${archiveSha}`]);
  const downloaded=join(folder,'remote.zip');
  r2(history,['--output',downloaded]);
  if(sha(downloaded)!==archiveSha) throw new Error('Remote backup checksum mismatch');
  run(zip,['t',`-p${process.env.BACKUP_ARCHIVE_PASSWORD}`,downloaded]);
  r2('erp-backups/latest.zip',['--upload-file',archive,'--header',`x-amz-meta-sha256: ${archiveSha}`]);
  const headers=r2('erp-backups/latest.zip',['--head']);
  if(!headers.toLowerCase().includes(archiveSha)) throw new Error('Latest backup metadata mismatch');
  manifest.remote={history,latest:'erp-backups/latest.zip',sha256:archiveSha,downloadVerified:true};
 }
 writeFileSync(join(folder,'verification.json'),JSON.stringify({...manifest,archive_sha256:archiveSha},null,2));
 console.log(JSON.stringify({folder,archive_sha256:archiveSha,uploaded:!!manifest.remote}));
} finally {await sql.end()}
