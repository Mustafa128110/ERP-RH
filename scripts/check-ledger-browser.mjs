import assert from 'node:assert/strict';
import http from 'node:http';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
// Real statement UI with a deterministic read endpoint; no financial writes.
const actions=`
 const records=Array.from({length:225},(_,i)=>({id:String(i),documentId:String(i),date:'2026-09-01',type:'item_sold',code:'SALES_INVOICE',documentStatus:'posted',reference:'REF-'+String(i).padStart(3,'0'),debit:10,credit:0,balance:(i+1)*10}));
 export async function getPartyLedgerPage(contactId,companyId,r={}){
  window.requests.push(r);
  await new Promise(resolve=>setTimeout(resolve,r.query==='REF-1'?550:20));
  const matched=records.filter(e=>!r.query||e.reference.includes(r.query));
  if(r.direction==='desc')matched.reverse();
  const page=Math.min(r.page||1,Math.max(1,Math.ceil(matched.length/100)));
  return {contactId,displayName:'Fixture party',entries:r.all?matched:matched.slice((page-1)*100,page*100),openingBalance:0,openingBalanceDocumentId:null,advancePaid:0,advanceReceived:0,summary:{opening:0,totalDebit:matched.length*10,totalCredit:0,closing:matched.length*10},history:{page,total:matched.length,pageSize:100,all:!!r.all,query:r.query||'',sort:'date',direction:r.direction||'asc'}};
 }
 export const getPartyAuditTrail=async()=>[];
 export const getLedgerInlineOptions=async()=>({companyOptions:[],contactOptions:[],bankAccountOptions:[],cashAccountOptions:[],chequeOptions:[]});
 export const deleteLedgerRow=async()=>{throw Error('Unexpected write')};
 export const setPartyOpeningBalance=deleteLedgerRow;
 export const getPartyOpeningBalance=async()=>null,previewLedgerRowDelete=async()=>null,previewPartyOpeningBalance=async()=>null,getPayment=async()=>null,getStockPurchase=async()=>null,listChequesForPurchases=async()=>[];
`;
const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {PartyLedgerDialog} from './components/modules/PartyLedgerDialog';window.requests=[];createRoot(document.getElementById('root')).render(<PartyLedgerDialog contactId='fixture' companyId='company' contactName='Fixture party' onClose={()=>{}} onExport={(fmt,data,entries,summary)=>{window.exported={fmt,count:entries.length,summary}}}/>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,platform:'browser',plugins:[{name:'ledger-fixture',setup(builder){
 builder.onResolve({filter:/^@\/lib\/client-actions\//},args=>({path:args.path,namespace:'actions'}));
 builder.onLoad({filter:/.*/,namespace:'actions'},()=>({contents:actions,loader:'js'}));
 builder.onResolve({filter:/^@\/components\/modules\/(PaymentForm|StockPurchaseForm)$/},args=>({path:args.path,namespace:'forms'}));
 builder.onLoad({filter:/.*/,namespace:'forms'},()=>({contents:'export const PaymentEditForm=()=>null;export const StockPurchaseCreateForm=()=>null;'}));
 builder.onResolve({filter:/^next\/(link|navigation)$/},args=>({path:args.path,namespace:'next'}));
 builder.onLoad({filter:/.*/,namespace:'next'},args=>({resolveDir:process.cwd(),contents:args.path.endsWith('link')?'import React from "react";export default function Link(p){return React.createElement("a",p)}':'export const useRouter=()=>({replace(){},refresh(){}}),usePathname=()=>"/ledger",useSearchParams=()=>new URLSearchParams();'}));
}}]});
const server=http.createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':'text/html');res.end(req.url==='/app.js'?bundle.outputFiles[0].text:'<!doctype html><div id="root"></div><script src="/app.js"></script>')});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,...(process.env.ERP_BROWSER_EXECUTABLE?{executablePath:process.env.ERP_BROWSER_EXECUTABLE}:{})});
try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 await page.getByText('225 matching records',{exact:false}).waitFor();
 assert.equal(await page.locator('tbody tr').count(),100);
 await page.getByRole('button',{name:'Next',exact:true}).click();await page.getByText('Page 2 of 3',{exact:false}).waitFor();
 await page.getByRole('button',{name:'Next',exact:true}).click();await page.getByText('Page 3 of 3',{exact:false}).waitFor();assert.equal(await page.locator('tbody tr').count(),25);
 await page.getByRole('button',{name:'PDF',exact:true}).click();await page.waitForFunction(()=>window.exported?.count===225);
 assert.equal((await page.evaluate(()=>window.exported)).summary.closing,2250);
 await page.getByPlaceholder('Item or ref…').fill('REF-000');await page.getByText('1 matching records',{exact:false}).waitFor();assert.equal(await page.locator('tbody tr').count(),1);
 await page.getByPlaceholder('Item or ref…').fill('REF-1');await page.waitForFunction(()=>window.requests.some(r=>r.query==='REF-1'));
 await page.getByPlaceholder('Item or ref…').fill('REF-224');await page.waitForFunction(()=>window.requests.at(-1)?.query==='REF-224');
 await new Promise(resolve=>setTimeout(resolve,700));assert.equal(await page.locator('tbody tr').count(),1);assert.ok((await page.locator('tbody').innerText()).includes('REF-224'));
 await page.getByPlaceholder('Item or ref…').fill('');await page.getByText('225 matching records',{exact:false}).waitFor();
 await page.getByRole('button',{name:'Load all matches for print or export',exact:true}).click();await page.getByRole('button',{name:'Use pages',exact:true}).waitFor();assert.equal(await page.locator('tbody tr').count(),225);
 assert.deepEqual(errors,[]);console.log('Ledger browser checks passed: bounded pages, filter reset, stale-response protection and complete export/all-record mode');
}finally{await browser.close();server.close()}
