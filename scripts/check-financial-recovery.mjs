import {build} from 'esbuild';
import {spawnSync} from 'node:child_process';
const url=new URL(process.env.DATABASE_URL_DIRECT||'');
if(url.hostname!=='127.0.0.1'||!/^\/restore_\d+$/.test(url.pathname)) throw new Error('Supply a disposable restored database URL');
await build({entryPoints:['lib/financial-recovery.check.ts'],outfile:'db-export/financial-recovery.cjs',bundle:true,packages:'external',platform:'node',format:'cjs',plugins:[{name:'framework-revalidation',setup(builder){
 builder.onResolve({filter:/^(server-only|next\/(cache|navigation))$/},args=>({path:args.path,namespace:'framework'}));
 builder.onLoad({filter:/.*/,namespace:'framework'},()=>({contents:'export function revalidatePath() {} export function redirect(){throw new Error("Unexpected redirect in financial fixture")};'}));
}}]});
const result=spawnSync(process.execPath,['--conditions=react-server','db-export/financial-recovery.cjs'],{stdio:'inherit',windowsHide:true,env:{...process.env,UPSTASH_REDIS_REST_URL:'',UPSTASH_REDIS_REST_TOKEN:''}});
process.exitCode=result.status??1;
