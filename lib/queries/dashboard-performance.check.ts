import {writeFileSync} from "node:fs";
import {performance} from "node:perf_hooks";
import {db} from "@/lib/db";
import {companies} from "@/lib/db/schema";
import {loadDashboard as baseline} from "./dashboard-reference.check";
import {loadDashboard as optimized} from "./dashboard";
async function main(){
 const ids=(await db.select({id:companies.id}).from(companies)).map(row=>row.id);
 const scopes={sales:ids,purchases:ids,expenses:ids,accounts:ids,stock:ids};
 const day=new Date().toISOString().slice(0,10);
 const samples={baseline:[] as number[],optimized:[] as number[]};
 await baseline(day,scopes);await optimized(day,scopes);
 for(let n=0;n<5;n++)for(const [name,read] of [['baseline',baseline],['optimized',optimized]] as const){
  const start=performance.now();await read(day,scopes);samples[name].push(performance.now()-start);
 }
 const median=(values:number[])=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
 const report={measuredAt:new Date().toISOString(),scope:'Read-only dashboard queries over both existing companies; warm connections; local client to Singapore',samples,medianBaseline:median(samples.baseline),medianOptimized:median(samples.optimized)};
 writeFileSync('docs/dashboard-performance.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
main().finally(()=>db.$client.end()).catch(error=>{console.error(error);process.exitCode=1});
