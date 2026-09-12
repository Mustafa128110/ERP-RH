import assert from 'node:assert/strict';
import http from 'node:http';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
const require=createRequire(import.meta.url);const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const bundle=await build({stdin:{contents:`
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
import {BatchAddDialog} from './components/ui/BatchAddDialog';import {DateField} from './components/ui/DateField';import {Dialog} from './components/ui/Dialog';
import {useBatchEditDraft} from './components/ui/useBatchEditDraft';import {DraftBanner} from './components/ui/useDraft';
import {queueBackgroundAction} from './lib/background-client';import {setClientUserId} from './lib/client-user';import * as draft from './lib/draft';import * as store from './lib/command-store';
setClientUserId('batch-check');let root;const recordId='10000000-0000-0000-0000-000000000001';
function Create(){const [date,setDate]=useState('2026-09-01');return <BatchAddDialog title="Check payments" draftKey="batch-check:create" initialRows={1} emptyRow={()=>({name:''})} headers={['Name']} renderRow={(row,i,update)=><td><input aria-label="Batch name" value={row.name} onChange={e=>update({name:e.target.value})}/></td>} toolbar={<DateField value={date} onChange={setDate}/>} draftMetadata={{date}} restoreDraftMetadata={value=>setDate(value.date)} onClose={()=>root.unmount()} onDone={()=>{window.done=true;root.unmount()}} onSubmit={rows=>queueBackgroundAction('payments.createPaymentsBatch',[rows.map(row=>({...row,date}))])}/>}
function Edit({revision}){const base=[{id:recordId,_revision:revision}];const [rows,setRows]=useState([{...base[0],name:'Original'}]);const recovery=useBatchEditDraft('contacts',[recordId],base,{rows},value=>setRows(value.rows));return <Dialog title="Edit contacts" onClose={()=>root.unmount()} footer={<button disabled={!recovery.ready||recovery.offerDraft} onClick={async()=>{const result=await queueBackgroundAction('contacts.updateContactsBatch',[rows]);if(result.success){window.done=true;root.unmount()}}}>Save edits</button>}><div {...recovery.attributes}>{recovery.offerDraft&&<DraftBanner noun="batch" onRestore={recovery.restore} onDiscard={recovery.discard} canRestore={recovery.canRestore} onDownload={recovery.download}/>}<fieldset disabled={!recovery.ready||recovery.offerDraft}><input aria-label="Edited name" value={rows[0].name} onChange={e=>setRows([{...rows[0],name:e.target.value}])}/></fieldset></div></Dialog>}
window.mount=(kind,revision='7')=>{root?.unmount();root=createRoot(document.getElementById('root'));window.done=false;flushSync(()=>root.render(kind==='create'?<Create/>:<Edit revision={revision}/>))};window.work={...draft,...store,recordId};
`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,jsx:'automatic',write:false,platform:'browser',plugins:[{name:'framework',setup(builder){builder.onResolve({filter:/^next\/offline$/},()=>({path:'offline',namespace:'framework'}));builder.onLoad({filter:/.*/,namespace:'framework'},()=>({contents:'export const useOffline=()=>false;'}));}}]});
const server=http.createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':'text/html');res.end(req.url==='/app.js'?bundle.outputFiles[0].text:'<!doctype html><div id="root"></div><script src="/app.js"></script>')});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,...(process.env.ERP_BROWSER_EXECUTABLE?{executablePath:process.env.ERP_BROWSER_EXECUTABLE}:{})});
try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(`http://127.0.0.1:${server.address().port}`);
 await page.evaluate(()=>window.mount('create'));await page.getByLabel('Batch name').fill('Payment input');await page.getByPlaceholder('DD-MM-YYYY').fill('11092026');
 await page.evaluate(()=>window.mount('create'));assert.equal(await page.getByLabel('Batch name').inputValue(),'Payment input');assert.equal(await page.getByPlaceholder('DD-MM-YYYY').inputValue(),'11-09-2026');
 await page.getByRole('button',{name:'Save',exact:true}).click();await page.waitForFunction(()=>window.done);
 const created=await page.evaluate(()=>work.listCommands('batch-check'));assert.equal(created[0].args[0][0].date,'2026-09-11');assert.equal(created[0].args[0][0].name,'Payment input');
 await page.evaluate(()=>window.mount('edit'));await page.getByLabel('Edited name').fill('Recovered contact');
 await page.evaluate(()=>window.mount('edit'));await page.getByRole('button',{name:'Restore it',exact:true}).click();assert.equal(await page.getByLabel('Edited name').inputValue(),'Recovered contact');
 await page.evaluate(()=>window.mount('edit','8'));assert.equal(await page.getByRole('button',{name:'Restore it',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Save edits'}).isDisabled(),true);
 await page.getByRole('button',{name:'Discard',exact:true}).click();await page.getByLabel('Edited name').fill('Current version edit');
 await page.getByRole('button',{name:'Save edits'}).click();await page.waitForFunction(()=>window.done);
 const edited=await page.evaluate(async()=>({row:(await work.listCommands('batch-check')).find(row=>row.action==='contacts.updateContactsBatch'),id:work.recordId}));assert.equal(edited.row.revisions['contacts:'+edited.id],'8');assert.equal(edited.row.args[0][0].name,'Current version edit');assert.deepEqual(errors,[]);
 console.log('Batch browser checks passed: complete row/date recovery, stale batch refusal, local queue handoff and exact base revisions');
}finally{await browser.close();server.close()}
