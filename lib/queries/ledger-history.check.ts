import assert from 'node:assert/strict';
import {sql} from 'drizzle-orm';
import {db} from '@/lib/db';
import {ledgerHistoryWindow} from './ledger-history';

async function main(){
 const source=sql`SELECT md5(n::text)::uuid AS "ledgerId",md5(n::text)::uuid AS "documentId",'2026-01-01'::date+n AS date,
  CASE WHEN n=0 THEN 'OPENING_BALANCE' ELSE 'SALES_INVOICE' END AS code,
  CASE WHEN n%7=0 AND n>0 THEN 'cancelled' ELSE 'posted' END AS "documentStatus",'REF-'||n AS number,
  CASE WHEN n=0 THEN 50.11 ELSE 10.01 END::numeric AS debit,CASE WHEN n%3=0 THEN 0.02 ELSE 0 END::numeric AS credit
  FROM generate_series(0,500) n`;
 const names=['ledgerId','documentId','date','code','documentStatus','number','debit','credit'];
 const query={getSQL:()=>source,getSelectedFields:()=>Object.fromEntries(names.map(name=>[name,{}]))};
 const full=await ledgerHistoryWindow(query,{all:true});
 assert.equal(full.total,430);assert.equal(full.openingBalance,50.09);
 const ids:string[]=[];
 for(let page=1;page<=5;page++){
  const part=await ledgerHistoryWindow(query,{page});assert.ok(part.ids.length<=100);assert.deepEqual(part.summary,full.summary);
  for(const entry of part.selected)assert.equal(entry.balance,full.balances.get(entry.id));
  ids.push(...part.ids);
 }
 assert.deepEqual(ids,full.ids);assert.equal(full.selected.at(-1)?.balance,full.summary.closing);
 const reverse=await ledgerHistoryWindow(query,{all:true,direction:'desc'});assert.deepEqual(reverse.selected,[...full.selected].reverse());
 const range=await ledgerHistoryWindow(query,{from:'2026-04-01',to:'2026-08-01',all:true});
 const rangeRaw=await db.execute<{id:string;debit:string;credit:string;date:string}>(sql`SELECT "ledgerId" AS id,debit,credit,date::text FROM (${source}) s WHERE "documentStatus"<>'cancelled' ORDER BY date,"ledgerId"`);
 const cents=(rows:{debit:string;credit:string}[])=>rows.reduce((sum,row)=>sum+Math.round(Number(row.debit)*100)-Math.round(Number(row.credit)*100),0);
 assert.equal(range.summary.opening,cents(rangeRaw.filter(row=>row.date<'2026-04-01'))/100);
 assert.equal(range.summary.closing,cents(rangeRaw.filter(row=>row.date<='2026-08-01'))/100);
 const search=await ledgerHistoryWindow(query,{from:'2026-04-01',query:'REF-499'});assert.equal(search.total,1);assert.equal(search.summary.opening,range.summary.opening);
 assert.equal((await ledgerHistoryWindow(query,{showCancelled:true,all:true})).total,501);
 assert.equal((await ledgerHistoryWindow(query,{page:99999})).info.page,5);
 assert.equal((await ledgerHistoryWindow(query,{query:"' OR 1=1 --"})).total,0);
 console.log('Ledger history checks passed: 501 entries, complete balances across pages, direction, dates, search, cancellations and full export');
}
main().finally(()=>db.$client.end()).catch(error=>{console.error(error);process.exitCode=1});
