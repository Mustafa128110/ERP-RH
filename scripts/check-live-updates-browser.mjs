import assert from "node:assert/strict";
import http from "node:http";
import {createRequire} from "node:module";
import {build} from "esbuild";
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||"playwright");
const entry=`
import React from 'react';import {createRoot} from 'react-dom/client';
import {SyncProvider,useSync} from './components/layout/SyncProvider';
import {CommandReview} from './components/layout/PendingWork';
import {DocumentTitle} from './components/layout/DocumentTitle';
import {useOptimisticRecords} from './lib/use-optimistic-records';
import {announceServerChange} from './lib/live-change';
import * as store from './lib/command-store';import * as client from './lib/background-client';import * as user from './lib/client-user';
const rows=[{id:'00000000-0000-0000-0000-000000000001',name:'Original',sku:'SKU'}];
function Monitor(){const {records,pending}=useOptimisticRecords(rows,'id','items');const {commands}=useSync();return <div><p id='name'>{records[0]?.name}</p><p id='pending'>{pending.length}</p><p id='count'>{commands.length}</p></div>;}
const root=createRoot(document.getElementById('root'));window.work={...store,...client,...user,announceServerChange};user.setClientUserId('user-a');
window.mount=()=>root.render(<SyncProvider><DocumentTitle/><Monitor/></SyncProvider>);
window.review=entry=>root.render(<CommandReview entry={entry} onClose={()=>{window.closedReview=true}}/>);window.mount();
`;
const bundle=await build({stdin:{contents:entry,loader:"tsx",resolveDir:process.cwd()},bundle:true,write:false,platform:"browser",jsx:"automatic",plugins:[{name:"framework",setup(builder){
 builder.onResolve({filter:/^next\/(navigation|link)$/},args=>({path:args.path,namespace:"next"}));
 builder.onLoad({filter:/.*/,namespace:"next"},args=>({resolveDir:process.cwd(),contents:args.path.endsWith("link")?'import React from "react";export default function Link(p){return React.createElement("a",p)}':'const router={refresh(){window.refreshes=(window.refreshes||0)+1},push(){},replace(){},prefetch(){}};export const useRouter=()=>router,usePathname=()=>"/inventory/stock",useSearchParams=()=>new URLSearchParams();'}));
}}]});
const server=http.createServer((request,response)=>{
 if(request.url==="/api/commands"){response.setHeader("Content-Type","application/json");response.end(JSON.stringify({outcome:"confirmed",result:{success:true}}));return;}
 response.setHeader("Content-Type",request.url==="/app.js"?"text/javascript":"text/html");response.end(request.url==="/app.js"?bundle.outputFiles[0].text:'<!doctype html><html><head><title>ERP</title></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const browser=await chromium.launch({headless:true,...(process.env.ERP_BROWSER_EXECUTABLE?{executablePath:process.env.ERP_BROWSER_EXECUTABLE}:{})});
try{
 const context=await browser.newContext(),url=`http://127.0.0.1:${server.address().port}`,page=await context.newPage(),second=await context.newPage(),errors=[];
 for(const tab of [page,second]){tab.on("pageerror",error=>errors.push(error.message));await tab.goto(url);await tab.locator("#name").waitFor();}
 await page.waitForFunction(()=>document.title==="Stock");await page.evaluate(()=>document.title="ERP");await page.waitForFunction(()=>document.title==="Stock");await page.reload();await page.waitForFunction(()=>document.title==="Stock");
 await context.setOffline(true);
 const operation=await page.evaluate(async()=>{const result=await work.queueBackgroundAction("products.updateProductsBatch",[{mode:"none"},[{id:"00000000-0000-0000-0000-000000000001",name:"Changed while offline"}]]);if(!result.queued)throw new Error(result.error);return result.operationId;});
 for(const tab of [page,second])await tab.waitForFunction(()=>document.getElementById("name").textContent==="Changed while offline"&&document.getElementById("pending").textContent==="1");
 await page.evaluate(async id=>work.changeCommand("user-a",id,row=>({...row,status:"failed",error:"Row 1: SKU is required.",updatedAt:Date.now()})),operation);
 for(const tab of [page,second])await tab.waitForFunction(()=>document.getElementById("name").textContent==="Original");
 await page.evaluate(async id=>{const entry=(await work.listCommands("user-a")).find(row=>row.id===id);window.review(entry);},operation);
 await page.getByRole("heading",{name:/Correct:/}).waitFor();await page.getByText("What needs correcting",{exact:true}).waitFor();await page.getByText("Row 1: SKU is required.",{exact:true}).waitFor();await page.getByLabel("Name",{exact:true}).fill("Corrected offline");await page.getByRole("button",{name:"Save correction and retry"}).click();
 await second.waitForFunction(()=>document.getElementById("name").textContent==="Corrected offline");
 await context.setOffline(false);await second.waitForFunction(()=>(window.refreshes||0)>0);
 await second.waitForFunction(()=>document.getElementById("pending").textContent==="1");
 assert.equal(await second.evaluate(async id=>(await work.listCommands("user-a")).find(row=>row.id===id).status,operation),"confirmed");
 const refreshBefore=await second.evaluate(()=>window.refreshes||0);await page.evaluate(()=>work.announceServerChange());await second.waitForFunction(before=>(window.refreshes||0)>before,refreshBefore);assert.equal(await second.evaluate(()=>window.refreshes),refreshBefore+1,"duplicate storage and BroadcastChannel notifications are coalesced");
 // A new account on the same browser cannot project another user's queue.
 await second.evaluate(()=>work.setClientUserId("user-b"));await second.waitForFunction(()=>document.getElementById("name").textContent==="Original"&&document.getElementById("count").textContent==="0");
 assert.deepEqual(errors,[]);console.log("Live-update browser checks passed: local queue projections, cross-tab edits and refusal rollback, correction grid, automatic confirmed refresh, account isolation, and hard-reload title recovery");
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
