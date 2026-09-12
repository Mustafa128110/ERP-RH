import assert from 'node:assert/strict';
import http from 'node:http';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const navigation=`
 import {useSyncExternalStore} from 'react';
 let url='/history?company=one&direction=made', version=0; const listeners=new Set();
 const subscribe=fn=>{listeners.add(fn);return()=>listeners.delete(fn)};
 window.navigate=next=>{version++;url=next;listeners.forEach(fn=>fn())};
 export const usePathname=()=>'/history';
 export function useSearchParams(){const current=useSyncExternalStore(subscribe,()=>url);return new URLSearchParams(current.split('?')[1])}
 export const useRouter=()=>({replace(next){const own=++version;setTimeout(()=>{if(own===version){url=next;listeners.forEach(fn=>fn())}},80)}});
`;
const bundled=await build({stdin:{contents:`
 import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
 import {useSearchParams} from 'next/navigation';
 import {HistoryProvider} from './components/ui/HistoryProvider';
 import {DataTable} from './components/ui/DataTable';
 const records=Array.from({length:350},(_,i)=>({id:String(i),name:'Record '+String(i+1).padStart(4,'0'),amount:i+1}));
 function App(){
  const params=useSearchParams(),[selected,setSelected]=useState([]);
  const query=params.get('q')||'',sort=params.get('sort')||'',direction=params.get('order')||params.get('direction')||'desc',all=params.get('all')==='1';
  let matched=records.filter(row=>row.name.toLowerCase().includes(query.toLowerCase()));
  if(sort==='amount')matched.sort((a,b)=>direction==='asc'?a.amount-b.amount:b.amount-a.amount);
  const page=Math.min(Math.max(1,Math.ceil(matched.length/100)),Number(params.get('page')||1));
  const info={query,sort,direction,all,page,pageSize:100,total:matched.length};
  return <><output id='url'>{params.toString()}</output><output id='selected'>{selected.length}</output>
   <HistoryProvider info={info}><DataTable history columns={[{key:'name',label:'Name'},{key:'amount',label:'Amount'}]} rows={all?matched:matched.slice((page-1)*100,page*100)} idKey='id' selected={selected} onSelectedChange={setSelected} searchPlaceholder='Search history'/></HistoryProvider></>;
 }
 createRoot(document.getElementById('root')).render(<App/>);
`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,platform:'browser',plugins:[{name:'navigation',setup(builder){
 builder.onResolve({filter:/^next\/(navigation|link)$/},args=>({path:args.path,namespace:'next'}));
 builder.onLoad({filter:/.*/,namespace:'next'},args=>({contents:args.path.endsWith('navigation')?navigation:'import React from "react";export default function Link(p){return React.createElement("a",p)}',resolveDir:process.cwd(),loader:'js'}));
}}]});
const server=http.createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':'text/html');res.end(req.url==='/app.js'?bundled.outputFiles[0].text:'<!doctype html><div id="root"></div><script src="/app.js"></script>')});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,...(process.env.ERP_BROWSER_EXECUTABLE?{executablePath:process.env.ERP_BROWSER_EXECUTABLE}:{})});
try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 await page.getByText('Record 0001',{exact:true}).waitFor();
 await page.getByRole('checkbox',{name:'Select rows on this page',exact:true}).check();
 assert.equal(await page.locator('#selected').textContent(),'100');
 await page.getByRole('button',{name:'Next',exact:true}).click();
 await page.getByText('Record 0101',{exact:true}).waitFor();
 await page.getByRole('columnheader',{name:'Amount'}).click();
 await page.getByText('Record 0350',{exact:true}).waitFor();
 assert.ok((await page.locator('#url').textContent()).includes('company=one'),'paging preserves company scope');
 assert.ok((await page.locator('#url').textContent()).includes('direction=made'),'sorting preserves the payment direction filter');
 assert.ok((await page.locator('#url').textContent()).includes('order='),'table sorting has its own direction parameter');
 await page.locator('[data-list]').focus();await page.keyboard.press('/');
 await page.getByPlaceholder('Search history').fill('Record 0349');
 await page.getByText('1 matching records',{exact:false}).waitFor();
 assert.equal(await page.locator('[data-row-index]').count(),1);
 await page.getByPlaceholder('Search history').fill('Record 03');
 await page.getByPlaceholder('Search history').fill('Record 02');
 await page.waitForFunction(()=>document.querySelector('#url').textContent.includes('q=Record+02'));
 assert.equal(await page.getByPlaceholder('Search history').inputValue(),'Record 02');
 await page.evaluate(()=>window.navigate('/history?company=one&sort=amount&direction=asc&q=Record+03'));
 await page.waitForFunction(()=>document.querySelector('input[placeholder="Search history"]').value==='Record 03');
 assert.equal(await page.locator('[data-row-index="0"]').innerText().then(s=>s.includes('Record 0300')),true);
 await page.getByPlaceholder('Search history').fill('No match');
 await page.getByText('0 matching records',{exact:false}).waitFor();
 await page.getByPlaceholder('Search history').fill('');
 await page.getByText('350 matching records',{exact:false}).waitFor();
 await page.getByRole('button',{name:'Load all matches for print or export'}).click();
 await page.getByRole('button',{name:'Use pages',exact:true}).waitFor();
 await page.evaluate(()=>window.dispatchEvent(new Event('beforeprint')));
 assert.equal(await page.locator('[data-row-index]').count(),350,'print all includes records beyond the first page');
 assert.deepEqual(errors,[]);
 console.log('History browser checks passed: whole-history search/sort, page selection, rapid typing, navigation state, empty search recovery and all-record printing');
}finally{await browser.close();server.close()}
