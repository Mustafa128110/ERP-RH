// Encrypted local source/config recovery. Never uploads or changes source files.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {readdirSync,readFileSync,writeFileSync,mkdirSync,lstatSync} from 'node:fs';
import {resolve,join,relative,sep} from 'node:path';
const root=resolve('.'),folder=resolve(process.argv[2]);
assert.ok(folder.startsWith(resolve('db-export')+sep),'Use a workspace backup directory');
assert.ok(process.env.BACKUP_ARCHIVE_PASSWORD,'Set the existing backup password');
mkdirSync(folder,{recursive:true});
const excluded=new Set(['node_modules','.next','db-export','coverage','out','build','graphify-out']);
function filesAt(directory){return readdirSync(directory,{withFileTypes:true}).flatMap(entry=>{
 const path=join(directory,entry.name);
 if(entry.isSymbolicLink())throw new Error('Archive symbolic links separately before recovery: '+relative(root,path));
 if(entry.isDirectory())return excluded.has(entry.name)?[]:filesAt(path);
 return /(?:\.tsbuildinfo|\.log)$/.test(entry.name)?[]:[path];
});}
const digest=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
const files=Object.fromEntries(filesAt(root).sort().map(file=>[relative(root,file),{sha256:digest(file),bytes:lstatSync(file).size}]));
assert.ok(files['.env']&&files['package-lock.json']&&files['lib'+sep+'db'+sep+'schema.ts']);
writeFileSync(join(folder,'project-source-manifest.json'),JSON.stringify({created_at_utc:new Date().toISOString(),files},null,2));
const list=join(folder,'source-files.txt');writeFileSync(list,Object.keys(files).join('\n'),'utf8');
const zip=resolve('db-export/restore-tools/7zip/x64/7za.exe'),archive=join(folder,'project-recovery.zip'),extract=join(folder,'restored-project');
function run(args){const result=spawnSync(zip,args,{cwd:root,windowsHide:true,encoding:'utf8',maxBuffer:5*1024*1024});if(result.status!==0)throw new Error('Project recovery archive failed verification');}
run(['a','-tzip','-mem=AES256',`-p${process.env.BACKUP_ARCHIVE_PASSWORD}`,'-scsUTF-8',archive,'@'+list]);
run(['t',`-p${process.env.BACKUP_ARCHIVE_PASSWORD}`,archive]);
run(['x','-y',`-p${process.env.BACKUP_ARCHIVE_PASSWORD}`,`-o${extract}`,archive]);
for(const [file,expected]of Object.entries(files))assert.equal(digest(join(extract,file)),expected.sha256,file);
const sha=digest(archive);writeFileSync(join(folder,'project-recovery.zip.sha256'),sha+'\n');
const proof={verified_at:new Date().toISOString(),files:Object.keys(files).length,all_file_digests_match:true,archive_sha256:sha,encrypted:true,uploaded:false};
writeFileSync(join(folder,'project-verification.json'),JSON.stringify(proof,null,2));
writeFileSync(join(folder,'RECOVERY.txt'),`Royal Hardware ERP recovery backup\n\nBoth ZIP archives are AES-256 encrypted with the existing BACKUP_ARCHIVE_PASSWORD from .env. Keep this password separately; the source archive contains credentials and must stay private. All artifacts remain local.\n\nlatest.zip: PostgreSQL custom snapshot.dump, schema.sql, data.sql, exact public/auth/migration table digests and manifest checksums. See restore-verification.json for an independently restored copy.\nproject-recovery.zip: application source, Git history, public assets, migrations, documentation, environment configuration and reference files. Dependencies, build caches, generated logs and older backup directories are excluded. Every extracted source file was checked against project-source-manifest.json.\n\nRecovery steps:\n1. Check each archive with Get-FileHash -Algorithm SHA256 against its .sha256 file.\n2. Extract with 7-Zip and the backup password. Verify database files against manifest.json and source files against project-source-manifest.json.\n3. Provision a NEW isolated PostgreSQL 17 / Supabase target, then restore snapshot.dump with PostgreSQL 17 pg_restore. Never test recovery over production. The loopback verification script is scripts/verify-backup-restore.mjs, port 55474.\n4. Supabase provider services, hosting configuration, extensions and platform roles need provisioning separately. Storage buckets/objects were empty at this snapshot. Authentication rows and application role/permission tables are included.\n5. Extract the project to a private directory, run npm ci, configure the recovered target credentials, then run npm run check, npm run check:db and npm run build. Verify the recovered app before switching traffic.\n\nThe database contains committed records at the consistent snapshot only. Browser drafts and device-local pending operations stay on their original device. Existing earlier verified backup folders are retained. These files are local only, as requested.\n`);
console.log(JSON.stringify({folder,...proof}));
