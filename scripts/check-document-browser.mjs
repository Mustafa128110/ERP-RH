import assert from "node:assert/strict";
import http from "node:http";
import { createRequire } from "node:module";
import { build } from "esbuild";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

// Actual document forms, draft hook and IndexedDB queue; only framework routing
// and server imports are replaced. No database writes or authenticated browser.
const bundled = await build({ stdin: { contents: `
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import { SaleFormPage } from './components/modules/SaleForm';
  import { StockPurchaseCreateForm } from './components/modules/StockPurchaseForm';
  import * as draft from './lib/draft';
  import * as store from './lib/command-store';
  import { setClientUserId } from './lib/client-user';
  const companyId='10000000-0000-0000-0000-000000000001';
  const accountId='10000000-0000-0000-0000-000000000002';
  const itemId='10000000-0000-0000-0000-000000000003';
  const contactId='10000000-0000-0000-0000-000000000004';
  const locationId='10000000-0000-0000-0000-000000000005';
  const unitId='10000000-0000-0000-0000-000000000006';
  const options={ companyOptions:[{id:companyId,name:'Royal Hardware'}],
    customerOptions:[{id:contactId,companyId,name:'Counter'}], supplierOptions:[{id:contactId,companyId,name:'Supplier'}],
    itemOptions:[{id:itemId,companyId,name:'Test item',rate:'10',salesRate:'20',baseUnitId:unitId,taxable:false}],
    unitOptions:[{id:unitId,name:'Each'}], bankAccountOptions:[{id:accountId,companyId,name:'Test bank'}],
    cashAccountOptions:[{id:accountId,companyId,name:'Cash on Hand'}], chequeOptions:[],taxOptions:[],conversionOptions:[],taxSettings:{},
    locationOptions:[{id:locationId,name:'Shop',locationType:'shop'}], documentTypeOptions:[] };
  const defaults={companyId,contactId,documentDate:'2026-09-01',discountTotal:'0',taxTotal:'0',shippingTotal:'0',
    isPaid:false,paidAmount:'0',bankAccountId:null,cashAccountId:null,chequeId:null,settlementType:null,saleType:'counter',
    purchasePaidMode:'no',purchaseSettlementAmount:'0',allocatedAmount:'0',shippingExpenseAmount:'0',legacyUntrackedSettlement:false,locationId,
    lines:[{itemId,locationId,unitId,quantity:'2',unitPrice:'20',unitCost:'10'}]};
  let root;
  window.mountDocument=(kind,id,revision)=>{
    root?.unmount(); root=createRoot(document.getElementById('form'));
    setClientUserId('document-check'); window.done=false;
    root.render(React.createElement(kind==='sale'?SaleFormPage:StockPurchaseCreateForm,{
      ...options,...(id?{[kind==='sale'?'saleId':'purchaseId']:id,defaults:{...defaults,_revision:revision}}:{}),
      ...(id || kind==='purchase' ? {onDone:()=>{window.done=true;root.unmount();root=null;}} : {})
    }));
  };
  window.work={...draft,...store,accountId};
`, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, platform: "browser", format: "iife",
  plugins: [{ name: "server-boundary", setup(builder) {
    builder.onResolve({ filter: /^@\/lib\/client-actions\/(sales|purchases)$/ }, args => ({path:args.path,namespace:"actions"}));
    builder.onLoad({filter:/.*/,namespace:"actions"}, args => ({ resolveDir:process.cwd(), contents: `
      import {queueBackgroundAction} from './lib/background-client';
      ${ (args.path.endsWith('sales') ? ['createSale','updateSale','deleteSale'] : ['createStockPurchase','updateStockPurchase','deleteStockPurchase'])
        .map(name=>`export const ${name}=(...args)=>queueBackgroundAction('${args.path.endsWith('sales')?'sales':'purchases'}.${name}',args);`).join('\n') }
      export const getCustomerOutstanding=async()=>({amount:'0'});
    ` }));
    builder.onResolve({filter:/^(next\/(navigation|link)|@\/components\/layout\/KeyboardShortcuts)$/}, args=>({path:args.path,namespace:"framework"}));
    builder.onLoad({filter:/.*/,namespace:"framework"},()=>({resolveDir:process.cwd(),contents:"import React from 'react'; export const usePathname=()=>String.fromCharCode(47); export const useSearchParams=()=>new URLSearchParams(); export const useRouter=()=>({push(){},refresh(){}}); export const useNewEntry=()=>{}; export default function Link(props){return React.createElement('a',props);}"}));
  }}] });
const server = http.createServer((request,response)=>{
  response.setHeader('Content-Type',request.url==='/work.js'?'text/javascript':'text/html');
  response.end(request.url==='/work.js'?bundled.outputFiles[0].text:'<!doctype html><div id="form"></div><script src="/work.js"></script>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,...(process.env.ERP_BROWSER_EXECUTABLE?{executablePath:process.env.ERP_BROWSER_EXECUTABLE}:{})});
try {
  const context=await browser.newContext(); const page=await context.newPage();
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  assert.deepEqual(errors,[], 'fixture initialization');
  for (const kind of ['sale','purchase']) {
    const id=crypto.randomUUID(),key=`edit:document-check:documents:${id}`;
    await page.evaluate(({kind,id})=>window.mountDocument(kind,id,'300'),{kind,id});
    await page.locator('select[name="isPaid"]').waitFor();
    assert.equal(await page.evaluate(key=>work.readDraft(key),key),null,'opening an unchanged edit should not create a draft');
    await page.getByPlaceholder('DD-MM-YYYY').fill('08092026');
    await page.locator('select[name="isPaid"]').selectOption('partial');
    await page.getByLabel(kind==='sale'?'Amount Paid':'Paid to Supplier',{exact:true}).fill('15');
    await page.getByRole('button',{name:'Account',exact:true}).click();
    const accountId=await page.evaluate(()=>work.accountId);
    await page.locator('select[name="bankAccountId"]').selectOption(accountId);
    if(kind==='sale') {
      const alternative=await page.locator('select[name="saleType"] option').evaluateAll(nodes=>nodes.find(node=>node.value!=='counter').value);
      await page.locator('select[name="saleType"]').selectOption(alternative);
    }
    const before=await page.locator('form').first().evaluate(form=>Object.fromEntries(new FormData(form)));
    const saved=await page.evaluate(key=>work.readDraft(key),key);
    assert.equal(saved.documentDate,'2026-09-08');assert.equal(saved.paidAmount,'15');
    await page.evaluate(({kind,id})=>window.mountDocument(kind,id,'300'),{kind,id});
    await page.getByRole('button',{name:'Restore it',exact:true}).waitFor();
    assert.equal(await page.locator('select[name="isPaid"]').isDisabled(),true);
    await page.getByRole('button',{name:'Restore it',exact:true}).click();
    const after=await page.locator('form').first().evaluate(form=>Object.fromEntries(new FormData(form)));
    delete before.operationId;delete after.operationId;
    assert.deepEqual(after,before,`${kind} recovery preserves the complete submission, including header fields`);
    await page.evaluate(({kind,id})=>window.mountDocument(kind,id,'301'),{kind,id});
    await page.getByText('This record changed since your unsaved edit.',{exact:false}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Restore it',exact:true}).count(),0);
    assert.equal(await page.locator('select[name="isPaid"]').isDisabled(),true);
    assert.equal((await page.evaluate(key=>work.readDraft(key),key))._revision,'300','a stale edit must remain unchanged for download');
    await page.getByRole('button',{name:'Discard',exact:true}).click();
    await page.getByPlaceholder('DD-MM-YYYY').fill('09092026');
    const identity=await page.evaluate(key=>work.draftOperationId(key),key);
    // Fail local persistence on the first save: the form and draft must survive.
    await page.evaluate(()=>{
      window.originalTransaction=IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction=function(...args){if(args[1]==='readwrite')throw new DOMException('Storage full','QuotaExceededError');return window.originalTransaction.apply(this,args);};
      document.querySelector('form').requestSubmit();
    });
    await page.getByText('Storage full',{exact:false}).waitFor();
    assert.ok(await page.evaluate(key=>work.readDraft(key),key));
    assert.equal(await page.evaluate(()=>window.done),false);
    await page.evaluate(()=>{IDBDatabase.prototype.transaction=window.originalTransaction;document.querySelector('form').requestSubmit();});
    await page.waitForFunction(()=>window.done);
    const rows=await page.evaluate(()=>work.listCommands('document-check'));
    const command=rows.find(row=>row.id===identity);
    assert.ok(command,`${kind} keeps its draft identity through a failed local handoff`);
    assert.equal(command.revisions[`documents:${id}`],'301');
    assert.equal(command.args.find(arg=>arg?.$form).$form.find(([name])=>name==='documentDate')[1],'2026-09-09');
    assert.equal(await page.evaluate(key=>work.readDraft(key),key),null,'successful local handoff clears the edit draft');
  }
  for (const kind of ['sale','purchase']) {
    const key=`${kind}:document-check`;
    await page.evaluate(kind=>window.mountDocument(kind),kind);
    await page.locator('select[name="isPaid"]').waitFor();
    await page.getByLabel('Item for line 1',{exact:true}).fill('Test item');
    await page.getByLabel('Quantity for line 1',{exact:true}).fill('2');
    await page.getByLabel('Unit price for line 1',{exact:true}).fill('20');
    if(kind==='purchase') await page.getByPlaceholder('Pick a supplier or type a new one').fill('Supplier');
    await page.getByPlaceholder('DD-MM-YYYY').fill('08092026');
    await page.locator('select[name="isPaid"]').selectOption('partial');
    await page.getByLabel(kind==='sale'?'Amount Paid':'Paid to Supplier',{exact:true}).fill('15');
    await page.getByRole('button',{name:'Account',exact:true}).click();
    await page.locator('select[name="bankAccountId"]').selectOption(await page.evaluate(()=>work.accountId));
    const before=await page.locator('form').first().evaluate(form=>Object.fromEntries(new FormData(form)));
    await page.evaluate(kind=>window.mountDocument(kind),kind);
    await page.getByRole('button',{name:'Restore it',exact:true}).click();
    const after=await page.locator('form').first().evaluate(form=>Object.fromEntries(new FormData(form)));
    delete before.operationId;delete after.operationId;
    assert.deepEqual(after,before,`${kind} create recovery includes the complete submitted fields`);
    const identity=await page.evaluate(key=>work.draftOperationId(key),key);
    await context.setOffline(true);
    await page.getByRole('button',{name:kind==='sale'?'Create Sale':'Next Purchase',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('[aria-label="Item for line 1"]').value==='');
    assert.equal(await page.getByPlaceholder('DD-MM-YYYY').inputValue(),new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date()).replaceAll('/','-'));
    await page.locator('select[name="isPaid"]').selectOption('partial');
    assert.equal(await page.getByLabel(kind==='sale'?'Amount Paid':'Paid to Supplier',{exact:true}).inputValue(),'','the next entry must not inherit a partial payment');
    const entry=await page.evaluate(async identity=>(await work.listCommands('document-check')).find(row=>row.id===identity),identity);
    assert.ok(entry,`${kind} resets after local commit, even without internet`);
    assert.equal(entry.status,'pending');
    await context.setOffline(false);
  }
  assert.deepEqual(errors,[],'document fixtures should not throw');
  console.log('Sale/purchase browser checks passed: complete create/edit recovery, version conflicts, quota failure and immediate offline next-entry reset');
} finally {await browser.close();server.close();}
