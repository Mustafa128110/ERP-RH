// Read-only production snapshot; writes only a new loopback clone and local archives.
// Copies every ERP/auth/migration row, verifies exact digests, then dumps locally.
import assert from 'node:assert/strict';
import postgres from 'postgres';
import {spawnSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
const baseline=process.env.BACKUP_TEMPLATE_DATABASE||JSON.parse(readFileSync('db-export/verified-20261121T133718Z/restore-verification.json','utf8')).database;
assert.match(baseline,/^(restore|feature_check)_\d+$/);
const id=new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d+Z/,'Z');
const folder=resolve('db-export',`portable-${id}`);mkdirSync(folder,{recursive:true});
const target=new URL(process.env.DATABASE_URL_DIRECT);assert.ok(target.username.includes('gvneuhadkktmhoxaazzg'));
if(process.env.BACKUP_DB_PORT)target.port=process.env.BACKUP_DB_PORT;
const remote=postgres(target.toString(),{max:1,prepare:false,ssl:'require',connect_timeout:20,...(process.env.BACKUP_HOST_ADDR?{host:process.env.BACKUP_HOST_ADDR}:{}),onnotice:()=>{}});
const admin=postgres('postgresql://restore_verify@127.0.0.1:55474/postgres',{max:1,onnotice:()=>{}});
const schemas=['public','auth','drizzle','supabase_migrations'];
const quote=value=>'"'+value.replaceAll('"','""')+'"';
const literal=value=>"'"+value.replaceAll("'","''")+"'";
const sha=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
const schemaQuery=`SELECT n.nspname AS schema,c.relname AS name,a.attname AS column,format_type(a.atttypid,a.atttypmod) AS type,a.attidentity AS identity,a.attgenerated AS generated FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid WHERE n.nspname IN (${schemas.map(literal).join(',')}) AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped ORDER BY n.nspname,c.relname,a.attnum`;
function run(exe,args,options={}){const result=spawnSync(exe,args,{windowsHide:true,encoding:'utf8',maxBuffer:20*1024*1024,...options});if(result.status!==0){writeFileSync(join(folder,'backup-error.log'),result.stderr??'');throw new Error('Local backup utility failed; see private backup-error.log');}return result.stdout;}
try{
 const snapshot=await remote.begin('isolation level repeatable read read only',async tx=>{
  await tx`SET LOCAL TIME ZONE 'UTC'`;
  console.log('Source snapshot connected');
  const [storage]=await tx`SELECT (SELECT count(*)::int FROM storage.objects) AS objects,(SELECT count(*)::int FROM storage.buckets) AS buckets`;
  assert.equal(storage.objects,0,'Uploaded files require a separate storage backup');assert.equal(storage.buckets,0);
  const columns=[...await tx.unsafe(schemaQuery)];
  console.log('Source schema read');
  const tables=[...new Map(columns.map(column=>[`${column.schema}.${column.name}`,{schema:column.schema,name:column.name}])).values()];
  const data=[...await tx.unsafe(tables.map(table=>`SELECT ${literal(table.schema)} AS schema,${literal(table.name)} AS name,count(*)::int AS rows,md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY to_jsonb(t)::text COLLATE "C"),'')) AS digest,coalesce(json_agg(t),'[]'::json)::text AS data FROM ${quote(table.schema)}.${quote(table.name)} t`).join(' UNION ALL '))];
  console.log('Source rows read');
  const sequences=[...await tx`SELECT schemaname AS schema,sequencename AS name FROM pg_sequences WHERE schemaname IN ('public','auth','drizzle','supabase_migrations')`];
  const values=sequences.length?[...await tx.unsafe(sequences.map(sequence=>`SELECT ${literal(sequence.schema+'.'+sequence.name)} AS name,last_value::text AS value,is_called AS called FROM ${quote(sequence.schema)}.${quote(sequence.name)}`).join(' UNION ALL '))]:[];
  return {columns,data,values,storage};
 });
 console.log(JSON.stringify({stage:'source snapshot read',tables:snapshot.data.length,rows:snapshot.data.reduce((sum,table)=>sum+table.rows,0)}));
 const database=`portable_${Date.now()}`;await admin.unsafe(`CREATE DATABASE ${quote(database)} TEMPLATE ${quote(baseline)}`);
 const local=postgres(`postgresql://restore_verify@127.0.0.1:55474/${database}`,{max:1,onnotice:()=>{}});
 try{
  assert.deepEqual([...await local.unsafe(schemaQuery)],snapshot.columns,'The local template must match the exact current ERP/auth schema before loading any records');
  await local.begin(async tx=>{
   await tx.unsafe("SET LOCAL session_replication_role='replica'; SET LOCAL standard_conforming_strings=on; SET LOCAL TIME ZONE 'UTC';");
   await tx.unsafe(`TRUNCATE ${snapshot.data.map(table=>quote(table.schema)+'.'+quote(table.name)).join(',')} CASCADE`);
   const inserts=snapshot.data.filter(table=>table.rows).map(table=>{
    const columns=snapshot.columns.filter(column=>column.schema===table.schema&&column.name===table.name&&!column.generated).map(column=>quote(column.column)).join(',');
    const name=quote(table.schema)+'.'+quote(table.name);
    return `INSERT INTO ${name}(${columns}) OVERRIDING SYSTEM VALUE SELECT ${columns} FROM json_populate_recordset(NULL::${name},${literal(table.data)}::json);`;
   });
   await tx.unsafe(inserts.join('\n'));
   if(snapshot.values.length)await tx.unsafe(`SELECT setval(name::regclass,value::bigint,called) FROM json_to_recordset(${literal(JSON.stringify(snapshot.values))}::json) AS sequences(name text,value text,called boolean)`);
   const checks=await tx.unsafe(snapshot.data.map(table=>`SELECT ${literal(table.schema)} AS schema,${literal(table.name)} AS name,count(*)::int AS rows,md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY to_jsonb(t)::text COLLATE "C"),'')) AS digest FROM ${quote(table.schema)}.${quote(table.name)} t`).join(' UNION ALL '));
   const key=(a,b)=>(a.schema+'.'+a.name).localeCompare(b.schema+'.'+b.name);
   assert.deepEqual([...checks].sort(key),snapshot.data.map(table=>({schema:table.schema,name:table.name,rows:table.rows,digest:table.digest})).sort(key),'Every copied row must match the consistent source snapshot');
  });
  const [auth]=await local`SELECT count(*)::int AS users FROM auth.users`;
  const pg=resolve('db-export/restore-tools/pgsql/bin'),url=`postgresql://restore_verify@127.0.0.1:55474/${database}`;
  run(join(pg,'pg_dump.exe'),['--format=custom','--no-owner','--no-privileges',`--dbname=${url}`,`--file=${join(folder,'snapshot.dump')}`]);
  run(join(pg,'pg_restore.exe'),['--schema-only','--no-owner','--no-privileges',`--file=${join(folder,'schema.sql')}`,join(folder,'snapshot.dump')]);
  run(join(pg,'pg_restore.exe'),['--data-only','--no-owner','--no-privileges',`--file=${join(folder,'data.sql')}`,join(folder,'snapshot.dump')]);
  const all=snapshot.data.map(table=>({schema:table.schema,name:table.name,rows:table.rows,digest:table.digest}));
  writeFileSync(join(folder,'scope-contents.json'),JSON.stringify(all,null,2));
  writeFileSync(join(folder,'contents.json'),JSON.stringify(all.filter(table=>table.schema==='public').map(({name,rows,digest})=>({name,rows:String(rows),digest})),null,2));
  const files=Object.fromEntries(['snapshot.dump','schema.sql','data.sql','scope-contents.json','contents.json'].map(file=>[file,sha(join(folder,file))]));
  const manifest={backup_id:id,created_at_utc:new Date().toISOString(),project:'gvneuhadkktmhoxaazzg',scope:'Every public ERP, auth and migration-history row; hosted provider services require provisioning',files};
  writeFileSync(join(folder,'manifest.json'),JSON.stringify(manifest,null,2));
  const zip=resolve('db-export/restore-tools/7zip/x64/7za.exe'),archive=join(folder,'latest.zip');
  assert.ok(process.env.BACKUP_ARCHIVE_PASSWORD);
  run(zip,['a','-tzip','-mem=AES256',`-p${process.env.BACKUP_ARCHIVE_PASSWORD}`,archive,...Object.keys(files),'manifest.json'],{cwd:folder});
  run(zip,['t',`-p${process.env.BACKUP_ARCHIVE_PASSWORD}`,archive]);
  writeFileSync(join(folder,'latest.zip.sha256'),sha(archive)+'\n');
  const report={verified_at:new Date().toISOString(),backup_id:id,database,tables:all.length,public_tables:all.filter(table=>table.schema==='public').length,auth_users:auth.users,all_source_digests_match:true,archive_sha256:sha(archive),uploaded:false,storage:snapshot.storage};
  writeFileSync(join(folder,'verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({folder,...report}));
 }finally{await local.end({timeout:5});}
}finally{await remote.end({timeout:5});await admin.end({timeout:5});}
