import assert from "node:assert/strict";
import {sql} from "drizzle-orm";
import {db} from "@/lib/db";
import {withReadSnapshot} from "@/lib/db/read-snapshot";
import {documentHistoryWindow} from "./history-window";
async function main(){
 await withReadSnapshot(async()=>{
  for(const code of ["SALES_INVOICE","PURCHASE_INVOICE"] as const){
   const all=await documentHistoryWindow(undefined,code,{all:true,sort:"total",direction:"asc"});
   const raw=await db.execute<{id:string}>(sql`SELECT documents.id FROM documents JOIN document_types ON document_types.id=documents.document_type_id WHERE document_types.code=${code} ORDER BY documents.grand_total ASC,documents.id`);
   assert.deepEqual(all.ids,raw.map(row=>row.id),'numeric sort covers the entire history');
   const paged:string[]=[];
   for(let page=1;page<=Math.ceil(all.total/100);page++){
    const current=await documentHistoryWindow(undefined,code,{page,sort:'total',direction:'asc'});
    assert.ok(current.ids.length<=100);assert.equal(current.total,all.total);assert.equal(current.outstanding,all.outstanding);
    paged.push(...current.ids);
   }
   assert.deepEqual(paged,all.ids,'every historical record is reachable exactly once');
   const pastEnd=await documentHistoryWindow(undefined,code,{page:1000000,sort:'total',direction:'asc'});
   assert.equal(pastEnd.info.page,Math.max(1,Math.ceil(all.total/100)),'old page links clamp to the last surviving page');
   assert.deepEqual(pastEnd.ids,all.ids.slice((pastEnd.info.page-1)*100));
   if(all.ids.length){
    const last=all.ids.at(-1)!;
    const [record]=await db.execute<{number:string}>(sql`SELECT number FROM documents WHERE id=${last}::uuid`);
    const found=await documentHistoryWindow(undefined,code,{query:`number:"${record.number}"`});
    assert.ok(found.ids.includes(last),'search finds a record outside the first page');
   }
   const escaped=await documentHistoryWindow(undefined,code,{query:"number:\"' OR 1=1 --\""});
   assert.equal(escaped.total,0);
  }
 });
 console.log('History pagination checks passed: bounded pages, complete dataset, numeric sorting, full-history search, stable totals and parameterized search');
}
main().finally(()=>db.$client.end()).catch(error=>{console.error(error);process.exitCode=1});
