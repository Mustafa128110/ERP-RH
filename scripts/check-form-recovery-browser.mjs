import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const bundled = await build({stdin:{contents:`
import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {FormRecovery,useRecoveryState} from './components/ui/FormRecovery';
import {DateField} from './components/ui/DateField';
import * as draft from './lib/draft';
import * as store from './lib/command-store';
import {setClientUserId} from './lib/client-user';
setClientUserId('recovery-check');
function Fields(){
 const [company,setCompany]=useRecoveryState('company','a');
 const [account,setAccount]=useRecoveryState('account','cash');
 const [granted,setGranted]=useRecoveryState('granted',new Set(['read']));
 return <form>
 <input name="name" defaultValue="Original"/>
 <select name="company" value={company} onChange={e=>{setCompany(e.target.value);setAccount('cash')}}><option>a</option><option>b</option></select>
 <button type="button" onClick={()=>setAccount('bank')}>Bank</button>
 <input type="hidden" name="account" value={account}/>
 {account==='bank' && <input name="reference" defaultValue=""/>}
 <button type="button" onClick={()=>setGranted(new Set(['read','write']))}>Grant</button>
 <input type="hidden" name="granted" value={JSON.stringify([...granted])}/>
 <DateField name="date" defaultValue="2026-09-01"/>
 <input name="password" type="password"/>
 </form>;
}
let root;
window.mount=(revision='300')=>{root?.unmount();root=createRoot(document.getElementById('root'));flushSync(()=>root.render(<FormRecovery domain="test" id="one" revision={revision}><Fields/></FormRecovery>))};
window.unmount=()=>root?.unmount(); window.work={...draft,...store};
`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife'});
const server=http.createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/work.js'?'text/javascript':'text/html');res.end(req.url==='/work.js'?bundled.outputFiles[0].text:'<!doctype html><div id="root"></div><script src="/work.js"></script>')});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,...(process.env.ERP_BROWSER_EXECUTABLE?{executablePath:process.env.ERP_BROWSER_EXECUTABLE}:{})});
try {
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 const key='edit:recovery-check:test:one';
 await page.evaluate(()=>window.mount());
 assert.equal(await page.evaluate(key=>work.readDraft(key),key),null);
 await page.locator('[name="company"]').selectOption('b');
 await page.getByRole('button',{name:'Bank',exact:true}).click();
 await page.locator('[name="reference"]').fill('Receipt 123');
 await page.getByRole('button',{name:'Grant',exact:true}).click();
 await page.getByPlaceholder('DD-MM-YYYY').fill('11092026');
 await page.locator('[name="name"]').fill('Changed');
 await page.locator('[name="password"]').fill('Never preserve this');
 const before=await page.locator('form').evaluate(form=>Object.fromEntries(new FormData(form)));
 const saved=await page.evaluate(key=>work.readDraft(key),key);
 assert.ok(!JSON.stringify(saved).includes('Never preserve this'));
 await page.evaluate(()=>window.mount());
 await page.getByRole('button',{name:'Restore edit',exact:true}).click();
 const after=await page.locator('form').evaluate(form=>Object.fromEntries(new FormData(form)));
 before.password='';assert.deepEqual(after,before,'restore controlled state, conditional fields, Set and hidden ISO date together');
 // Dispatch and navigate in the same task, before a zero-delay timer can run.
 await page.evaluate(()=>{const input=document.querySelector('[name="name"]');input.value='Last keystroke';input.dispatchEvent(new Event('input',{bubbles:true}));window.unmount();window.mount()});
 await page.getByRole('button',{name:'Restore edit',exact:true}).click();
 assert.equal(await page.locator('[name="name"]').inputValue(),'Last keystroke');
 await page.evaluate(()=>window.mount('301'));
 assert.equal(await page.getByRole('button',{name:'Restore edit',exact:true}).count(),0);
 assert.equal(await page.locator('[name="name"]').isDisabled(),true);
 assert.equal((await page.evaluate(key=>work.readDraft(key),key)).revision,'300');
 await page.getByRole('button',{name:'Discard edit',exact:true}).click();
 assert.equal(await page.locator('[name="name"]').isDisabled(),false);
 // A malformed collection must be rejected before React receives it as state.
 await page.evaluate(({key,saved})=>{work.saveDraft(key,{...saved,revision:'301',states:{...saved.states,granted:JSON.stringify(['value','not a permission set'])}});window.mount('301')},{key,saved});
 await page.getByRole('button',{name:'Restore edit',exact:true}).click();
 await page.getByRole('alert').waitFor();
 assert.equal(await page.locator('[name="name"]').inputValue(),'Original');
 assert.equal(await page.locator('[name="name"]').isDisabled(),true);
 assert.ok(await page.evaluate(key=>work.readDraft(key),key),'malformed input remains downloadable');
 await page.getByRole('button',{name:'Discard edit',exact:true}).click();
 // Real IndexedDB compaction keeps every unresolved input and every receipt.
 const result=await page.evaluate(async()=>{
  const now=Date.now(),base={userId:'compact',action:'sales.createSale',version:1,path:'/',label:'Sale',attempts:0,createdAt:now-9*86400000,updatedAt:now-8*86400000};
  const rows=Array.from({length:105},(_,n)=>({...base,id:crypto.randomUUID(),status:'confirmed',args:[{quantity:n}],result:{success:true,id:String(n)}}));
  rows.push({...base,id:crypto.randomUUID(),status:'pending',args:['Offline input']});
  await Promise.all(rows.map(work.addCommand));
  const count=await work.compactConfirmedCommands('compact',now);
  let current=await work.listCommands('compact');
  const compacted=current.find(row=>row.compactedAt),original=rows.find(row=>row.id===compacted.id);
  await work.addCommand(original);
  let refused=false;try{await work.addCommand({...original,args:['Different sale']})}catch{refused=true}
  current=await work.listCommands('compact');
  return {count,total:current.length,refused,pending:current.find(row=>row.status==='pending').args,receipt:current.find(row=>row.id===compacted.id).result};
 });
 assert.equal(result.count,5);assert.equal(result.total,106);assert.equal(result.refused,true);assert.deepEqual(result.pending,['Offline input']);assert.equal(result.receipt.success,true);
 assert.deepEqual(errors,[]);
 console.log('Form recovery and compaction browser checks passed: controlled fields, dates, permission sets, fast navigation, stale revisions, secret exclusion, receipt identity and unresolved input retention');
} finally {await browser.close();server.close()}
