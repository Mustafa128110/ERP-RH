import assert from 'node:assert/strict';
import {sql} from 'drizzle-orm';
import {db} from '@/lib/db';
import {listHistoryWindow} from './list-history';
import {paymentHistory,expenseHistory,marketHistory,movementHistory} from './history-configs';

async function main(){
 const rollback=new Error('rollback');
 try{await db.transaction(async tx=>{
  // Repeated groups span every proposed page boundary; one group alone has
  // 130 records. Paging must never silently drop members or change its total.
  const values=sql`SELECT n::text AS id,n/3 AS party,CASE WHEN n<130 THEN 0 ELSE n/3 END AS expense_party,n::numeric AS amount FROM generate_series(0,800) n`;
  const source=sql`SELECT id,'company'::text AS "companyId",party::text AS "contactId",'2026-09-01'::date AS "documentDate",'PAYMENT_MADE'::text AS code,'2026-09-01'::timestamp AS "createdAt",'Company'::text AS company,'Contact '||party AS contact,amount AS "grandTotal",null::text AS "bankAccountName",'Cash'::text AS "cashAccountName",null::text AS "chequeNumber",'PAY-'||id AS number FROM (${values}) v`;
  const names=['id','companyId','contactId','documentDate','code','createdAt','company','contact','grandTotal','bankAccountName','cashAccountName','chequeNumber','number'];
  const query={getSQL:()=>source,getSelectedFields:()=>Object.fromEntries(names.map(name=>[name,{}]))};
  // Use the transaction through the normal database proxy.
  const {commandContext}=await import('@/lib/db/command-context');
  await commandContext.run({database:tx,afterCommit:[]},async()=>{
   const all=await listHistoryWindow(query,{all:true,sort:'amount',direction:'desc'},paymentHistory);
   assert.equal(all.total,267);assert.equal(all.recordTotal,801);
   const ids:string[]=[];
   for(let page=1;page<=3;page++){const part=await listHistoryWindow(query,{page,sort:'amount',direction:'desc'},paymentHistory);assert.equal(part.total,267);assert.equal(part.ids.length,page===3?201:300);ids.push(...part.ids)}
   assert.deepEqual(ids,all.ids);assert.equal(new Set(ids).size,801);
   const found=await listHistoryWindow(query,{query:'number:PAY-800'},paymentHistory);
   assert.deepEqual([...found.ids].sort(),['798','799','800']);assert.equal(found.recordTotal,3,'search includes the full matching group');
   const empty=await listHistoryWindow(query,{query:"number:\"' OR 1=1 --\""},paymentHistory);assert.equal(empty.total,0);
   const last=await listHistoryWindow(query,{page:999999},paymentHistory);assert.equal(last.info.page,3);
   const expenseSource=sql`SELECT id,'company'::text AS "companyId",expense_party::text AS "expenseCategoryId",'2026-09-01'::date AS "expenseDate",'posted'::text AS status,'2026-09-01'::timestamp AS "createdAt",'Company'::text AS company,'Category '||expense_party AS category,amount,null::text AS "bankAccountName",'Cash'::text AS "cashAccountName",null::text AS "chequeNumber",'Staff'::text AS "createdByName",'Note-'||id AS notes FROM (${values}) v`;
   const expenseNames=['id','companyId','expenseCategoryId','expenseDate','status','createdAt','company','category','amount','bankAccountName','cashAccountName','chequeNumber','createdByName','notes'];
   const expenses={getSQL:()=>expenseSource,getSelectedFields:()=>Object.fromEntries(expenseNames.map(name=>[name,{}]))};
   const group=await listHistoryWindow(expenses,{query:'notes:Note-0'},expenseHistory);
   assert.equal(group.ids.length,130,'a group larger than the page size remains whole');
   const expenseAll=await listHistoryWindow(expenses,{all:true},expenseHistory);const expenseIds:string[]=[];
   for(let page=1;page<=Math.ceil(expenseAll.total/100);page++)expenseIds.push(...(await listHistoryWindow(expenses,{page},expenseHistory)).ids);
   assert.deepEqual(expenseIds,expenseAll.ids);assert.equal(expenseIds.length,801);
   assert.ok(marketHistory.fields.status&&movementHistory.fields.quantity);
  });
  throw rollback;
 })}catch(error){if(error!==rollback)throw error}
 console.log('Generic history checks passed: whole groups, complete dataset, numeric sort, off-page search, literal parameters and clamped pages');
}
main().finally(()=>db.$client.end()).catch(error=>{console.error(error);process.exitCode=1});
