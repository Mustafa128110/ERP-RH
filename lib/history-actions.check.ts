import assert from 'node:assert/strict';
import {sql} from 'drizzle-orm';
import {db} from './db';
import {sessionQuery} from './db/session-query';
import {runAsWhatsAppUser} from './whatsapp-agent/context';
import type {AuthSession} from './auth/session';
import {listPaymentsPage} from './actions/payments';
import {listExpensesPage} from './actions/expenses';
import {listQuotationsPage} from './actions/quotations';
import {listMarketPurchaseRequestsPage} from './actions/market-purchases';
import {listStockMovementsPage} from './actions/stock-movements';
import {listStockTransfersPage} from './actions/stock-transfers';
import {listStockAdjustmentsPage} from './actions/stock-adjustments';
import {listInterCompanySalesPage} from './actions/inter-company';
import {listCashTransfersPage} from './actions/transfers';
import {getPartyLedger,getPartyLedgerPage} from './actions/ledger';
import type {HistoryRequest,HistoryInfo} from './history-window';

async function main(){
 const [user]=await db.execute<{auth:string}>(sql`SELECT supabase_auth_id AS auth FROM users WHERE status='active' ORDER BY created_at LIMIT 1`);
 const [row]=await sessionQuery(user.auth);
 const session:AuthSession={userId:row.id,supabaseAuthId:row.supabase_auth_id,name:row.name,email:row.email,roleNames:row.role_names,globalPermissions:new Set(row.perms.filter(p=>p.companyId===null).map(p=>p.key)),permissionsByCompany:new Map(row.company_ids.map(id=>[id,new Set(row.perms.filter(p=>p.companyId===id).map(p=>p.key))])),companyIds:row.company_ids,warehouseIds:row.warehouse_ids,uiTheme:row.ui_theme,uiScale:row.ui_scale};
 const lists:Record<string,(request:HistoryRequest)=>Promise<{records:{id:string}[];info:HistoryInfo}>>={payments:r=>listPaymentsPage({},r),expenses:r=>listExpensesPage({},r),quotations:listQuotationsPage,market:listMarketPurchaseRequestsPage,movements:r=>listStockMovementsPage({},r),stockTransfers:listStockTransfersPage,adjustments:r=>listStockAdjustmentsPage(undefined,r),interCompany:listInterCompanySalesPage,cashTransfers:listCashTransfersPage};
 await runAsWhatsAppUser(session,async()=>{
  for(const [name,read] of Object.entries(lists)){
   const all=await read({all:true});const ids:string[]=[];
   for(let page=1;page<=Math.max(1,Math.ceil(all.info.total/100));page++){
    const current=await read({page});assert.equal(current.info.total,all.info.total);ids.push(...current.records.map(row=>row.id));
   }
   assert.deepEqual(ids,all.records.map(row=>row.id),`${name}: every record appears exactly once`);
   assert.equal(new Set(ids).size,ids.length);
   const empty=await read({query:"' OR 1=1 --"});assert.equal(empty.info.total,0);
   console.log(`ok ${name}: ${ids.length} records, ${all.info.total} groups`);
  }
  const parties=await db.execute<{contact:string;company:string}>(sql`SELECT d.contact_id AS contact,d.company_id AS company FROM documents d JOIN ledger_entries le ON le.document_id=d.id WHERE d.contact_id IS NOT NULL AND d.company_id IN (${sql.join(session.companyIds.map(id=>sql`${id}::uuid`),sql`,`)}) GROUP BY d.contact_id,d.company_id ORDER BY count(*) DESC LIMIT 4`);
  for(const party of parties){
   const original=await getPartyLedger(party.contact,party.company);
   const full=await getPartyLedgerPage(party.contact,party.company,{all:true});assert.ok(full?.history&&full.summary&&original);
   assert.deepEqual(new Set(full.entries.map(e=>e.id)),new Set(original.entries.filter(e=>e.documentStatus!=='cancelled').map(e=>e.id)));
   assert.equal(full.advancePaid,original.advancePaid);assert.equal(full.advanceReceived,original.advanceReceived);
   const paged=[];
   for(let page=1;page<=Math.max(1,Math.ceil(full.history.total/100));page++){
    const part=await getPartyLedgerPage(party.contact,party.company,{page});assert.ok(part);assert.deepEqual(part.summary,full.summary);paged.push(...part.entries);
   }
   assert.deepEqual(paged,full.entries,'page details, settlements and balances equal full export');
   const reverse=await getPartyLedgerPage(party.contact,party.company,{all:true,direction:'desc'});
   assert.deepEqual(reverse?.entries,[...full.entries].reverse(),'sorting never changes a row balance');
   const total=original.entries.filter(e=>e.documentStatus!=='cancelled').reduce((sum,e)=>sum+Math.round(e.debit*100)-Math.round(e.credit*100),0)/100;
   assert.equal(full.summary.closing,total);
   if(full.entries.length){const entry=full.entries.at(-1)!;const search=await getPartyLedgerPage(party.contact,party.company,{query:entry.reference!});assert.ok(search?.entries.some(e=>e.id===entry.id));}
   console.log(`ok ledger: ${full.entries.length} entries, complete summaries, advances, allocation links and stable balances`);
  }
 });
 const emptySession={...session,companyIds:[],permissionsByCompany:new Map()};
 await runAsWhatsAppUser(emptySession,async()=>{for(const read of Object.values(lists))assert.equal((await read({all:true})).info.total,0,'empty company scope cannot expose history');});
}
main().finally(()=>db.$client.end()).catch(error=>{console.error(error);process.exitCode=1});
