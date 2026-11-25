// Real shared components with isolated, browser-only records and action stubs.
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFileSync,readdirSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,join,basename} from 'node:path';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const out=resolve('db-export/fixed-table-browser');mkdirSync(out,{recursive:true});
const entry=`
import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import{DateField}from'./components/ui/DateField';import{DataTable}from'./components/ui/DataTable';import{PageHeader}from'./components/ui/PageHeader';
import{ColumnSizing}from'./components/layout/ColumnSizing';import{Topbar}from'./components/layout/Topbar';
import{Sidebar}from'./components/layout/Sidebar';import{TableWorkspace,WorkspaceControls}from'./components/layout/TableWorkspace';
window.actionLog=[];
const columns=[{key:'name',label:'Name',render:row=><span className='truncate'>{row.name}</span>},
 {key:'code',label:'Reference',hideOnMobile:true},{key:'date',label:'Date'},{key:'createdAt',label:'Created at'},
 {key:'total',label:'Total',align:'right'},{key:'balance',label:'Balance',align:'right'},{key:'status',label:'Status'},
 {key:'actions',label:'',render:()=> <button type='button' aria-label='Row action' onClick={()=>window.actionLog.push('row')}>Edit</button>}];
const original=Array.from({length:2000},(_,i)=>({id:String(i),name:i===0?'A long product and customer name that wraps naturally without hiding any part of its description. '.repeat(4):'Browser fixture '+i,
 code:i===0?'LONG-REFERENCE-'.repeat(16):'REF-'+i,date:'25-11-2026',createdAt:'25-11-2026 23:59:59',total:'-9,999,999,999,999,999.99',balance:'9,999,999,999,999,999.99',status:'Posted'}));
function App(){const[selected,setSelected]=useState([]),[rows,setRows]=useState(original),[local,setLocal]=useState(false);window.openLocal=()=>setLocal(true);window.closeLocal=()=>setLocal(false);
 window.resetNames=()=>setRows(original);window.shortRows=()=>setRows(original.slice(1,17));
 window.changeName=()=>setRows(previous=>previous.map((row,index)=>index?row:{...row,name:row.name+' EXTRA'.repeat(160)}));
 return <TableWorkspace><ColumnSizing/><div className='workspace-sidebar contents'><Sidebar permissions={['sales.view','products.view']}/></div>
 <div className='flex min-w-0 flex-1 flex-col overflow-hidden'><Topbar username='Browser fixture' channels={[{id:'counter',name:'Counter Sales'},{id:'m52',name:'M52'}]} selected='counter'/>
 <main data-workspace-main className='flex-1 overflow-x-hidden overflow-y-auto bg-ivory p-4'>
 <div className='flex h-full min-h-0 flex-col gap-2'><PageHeader title='Fixed table fixture' subtitle='Isolated browser check'>
 <button type='button' onClick={()=>window.actionLog.push('add')} className='rounded border border-sand px-3 py-2'>Add record</button>
 <button type='button' disabled={!selected.length} className='rounded border border-sand px-3 py-2'>Edit selected ({selected.length})</button>
 </PageHeader><WorkspaceControls label='Fixture filters' className='flex flex-wrap gap-2'><input aria-label='Fixture filter' defaultValue='Keep this value' className='rounded border border-sand px-3 py-2'/>
 <select aria-label='Fixture status' defaultValue='posted' className='rounded border border-sand px-3 py-2'><option value='posted'>Posted records</option><option value='all'>All records</option></select></WorkspaceControls>
 <DataTable columns={columns} rows={rows} idKey='id' selected={selected} onSelectedChange={setSelected} onRowClick={()=>{}} searchPlaceholder='Find fixture records'/></div>
 </main></div>{local&&<div role='dialog' aria-label='Fixture local dialog' className='fixed inset-8 z-50 flex flex-col gap-2 border border-sand bg-white p-4'><PageHeader title='Local dialog heading'><button type='button' onClick={()=>window.actionLog.push('local')}>Local action</button></PageHeader><div className='overflow-auto'><table data-native-fixture><thead><tr><th>Date</th><th className='text-right'>Amount</th><th>Name</th></tr></thead><tbody><tr><td><DateField aria-label='Native date input' defaultValue='2026-11-25' className='px-2 py-1 text-sm'/></td><td><input type='number' aria-label='Native amount input' readOnly value='-9999999999999999.99' className='w-full px-2 py-1 text-sm'/></td><td>A native wrapped name</td></tr></tbody></table></div><DataTable columns={columns} rows={original.slice(1,4)} idKey='id' globalShortcuts={false} searchPlaceholder='Find local records'/></div>}</TableWorkspace>;
}
createRoot(document.getElementById('root')).render(<App/>);
`;
const bundle=await build({stdin:{contents:entry,loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,platform:'browser',jsx:'automatic',plugins:[{name:'isolated-context',setup(builder){
 builder.onResolve({filter:/^next\/(navigation|link)$/},args=>({path:args.path,namespace:'next'}));
 builder.onLoad({filter:/.*/,namespace:'next'},args=>({loader:'js',resolveDir:process.cwd(),contents:args.path.endsWith('link')?
  'import React from "react";export default function Link({prefetch,...props}){return React.createElement("a",props)}':
  'import {useState,useEffect} from "react";export function usePathname(){const [p,setP]=useState("/fixture");useEffect(()=>{const fn=()=>setP("/another-page");window.addEventListener("fixture-navigation",fn);return()=>window.removeEventListener("fixture-navigation",fn)},[]);return p}export const useRouter=()=>({push(){},prefetch(){}}),useSearchParams=()=>new URLSearchParams();'}));
 builder.onResolve({filter:/^@\/components\/layout\/(SyncProvider|SyncStatus|KeyboardShortcuts)$/},args=>({path:args.path,namespace:'context'}));
 builder.onLoad({filter:/.*/,namespace:'context'},args=>({contents:args.path.endsWith('SyncProvider')?'export const useSync=()=>({entries:[]});':args.path.endsWith('SyncStatus')?'export const SyncStatus=()=>null;':'export const openShortcuts=()=>window.actionLog.push("shortcuts");',loader:'js'}));
 builder.onResolve({filter:/^@\/lib\/(auth\/actions|actions\/channels|actions\/search)$/},args=>({path:args.path,namespace:'actions'}));
 builder.onLoad({filter:/.*/,namespace:'actions'},()=>({contents:'export const logout=async()=>({}),setScopeChannel=async value=>{window.actionLog.push(value);return{}},globalSearch=async()=>[];',loader:'js'}));
}}]});
const cssRoot=existsSync('.next/static')?'.next/static':'.next/dev/static';
const css=readdirSync(cssRoot,{recursive:true}).filter(file=>String(file).endsWith('.css')).map(file=>readFileSync(join(cssRoot,file),'utf8')).join('\n');
assert.ok(css.includes('workspace-options'),'Build the current application styles before checking');
const server=http.createServer((req,res)=>{
 if(req.url?.startsWith('/media/')){const file=join(cssRoot,'media',basename(req.url));if(existsSync(file)){res.setHeader('Content-Type','font/woff2');res.end(readFileSync(file));return;}}
 res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':req.url==='/app.css'?'text/css':'text/html');
 res.end(req.url==='/app.js'?bundle.outputFiles[0].text:req.url==='/app.css'?css:'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,...(process.env.ERP_BROWSER_EXECUTABLE?{executablePath:process.env.ERP_BROWSER_EXECUTABLE}:{})});
try{
 const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>localStorage.setItem('erp:global-column-widths:v2',JSON.stringify({item:10000,total:10000})));
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 await page.locator('[data-row-index="0"]').waitFor();await page.evaluate(()=>document.fonts.ready);
 const geometry=()=>page.locator('[data-list] table').evaluate(table=>Array.from(table.querySelectorAll('thead th')).map(cell=>Math.round(cell.getBoundingClientRect().width)));
 await page.waitForFunction(()=>document.querySelector('[data-list] table')?.getBoundingClientRect().width<5000);
 const before=await geometry();
 assert.equal(before[0],48);assert.equal(before[1],64);assert.equal(before[4],144);assert.equal(before[6],256);
 const readable=await page.locator('[data-row-index="0"]').evaluate(row=>Array.from(row.querySelectorAll('[data-cell-kind="number"],[data-cell-kind="date"]')).map(cell=>({label:cell.dataset.label,scroll:cell.scrollWidth,width:cell.clientWidth,space:getComputedStyle(cell).whiteSpace})));
 for(const fact of readable){assert.equal(fact.space,'nowrap');assert.ok(fact.scroll<=fact.width+1,'Complete figures and dates must fit: '+JSON.stringify(fact));}
 assert.ok(await page.locator('[data-row-index="0"] [data-label="Name"]').evaluate(cell=>cell.getBoundingClientRect().height>60&&getComputedStyle(cell.querySelector('span span')).whiteSpace==='normal'));
 await page.evaluate(()=>window.changeName());assert.deepEqual(await geometry(),before,'Longer records cannot resize fixed columns');await page.evaluate(()=>window.resetNames());
 await page.getByLabel('Fixture filter',{exact:true}).fill('Retain the typed filter');
 await page.locator('[data-row-index="0"] input[type=checkbox]').check();
 await page.locator('[data-list]').evaluate(element=>element.scrollTop=900);
 await page.locator('[data-workspace-focused]').waitFor();
 const full=await page.locator('[data-list]').boundingBox();
 assert.ok(Math.abs(full.x)<2&&Math.abs(full.y)<2&&Math.abs(full.width-1600)<2&&Math.abs(full.height-1000)<2,'Scrolled table must fill the viewport: '+JSON.stringify(full));
 await page.getByRole('button',{name:'Table options',exact:true}).click();
 const menu=page.getByRole('dialog',{name:'Table options',exact:true});await menu.waitFor({state:'visible'});
 assert.ok(await menu.evaluate(node=>{const box=node.getBoundingClientRect();return getComputedStyle(node).borderRadius==='50%'&&Math.abs(box.width-box.height)<2&&box.right<=innerWidth&&box.bottom<=innerHeight;}));
 assert.equal(await menu.getByLabel('Fixture filter',{exact:true}).inputValue(),'Retain the typed filter');
 await menu.getByRole('button',{name:'Edit selected (1)',exact:true}).waitFor({state:'visible'});
 await menu.getByRole('button',{name:'Add record',exact:true}).click();
 assert.ok(await page.evaluate(()=>window.actionLog.includes('add')),'The original action handler must work inside the popup');
 await page.keyboard.press('Escape');await menu.waitFor({state:'hidden'});
 assert.equal(await page.getByRole('button',{name:'Table options',exact:true}).evaluate(node=>document.activeElement===node),true);
 await page.screenshot({path:join(out,'desktop-scrolled.png')});
 await page.locator('[data-list]').focus();await page.keyboard.press('Home');
 await page.locator('[data-workspace-focused]').waitFor({state:'detached'});
 await page.getByRole('heading',{name:'Fixed table fixture',exact:true}).waitFor({state:'visible'});
 assert.equal(await page.getByLabel('Fixture filter',{exact:true}).inputValue(),'Retain the typed filter');
 assert.equal(await page.getByRole('button',{name:'Table options',exact:true}).count(),0);
 await page.screenshot({path:join(out,'desktop-top.png')});
 await page.locator('[data-list]').evaluate(node=>node.scrollTop=200);await page.locator('[data-workspace-focused]').waitFor();
 await page.locator('[data-list]').evaluate(node=>node.scrollTop=0);await page.locator('[data-workspace-focused]').waitFor({state:'detached'});
 await page.locator('[data-list]').evaluate(node=>node.scrollTop=600);await page.locator('[data-workspace-focused]').waitFor();
 await page.getByRole('button',{name:'Table options',exact:true}).click();
 await menu.getByRole('button',{name:'Find fixture records',exact:true}).click();
 await menu.getByRole('searchbox',{name:'Find fixture records',exact:true}).fill('Browser fixture');
 await page.locator('[data-workspace-focused]').waitFor({state:'detached'});
 assert.equal(await page.getByRole('searchbox',{name:'Find fixture records',exact:true}).evaluate(node=>document.activeElement===node),true,'Typing focus must survive the move back to the toolbar');
 await page.keyboard.type(' 1');assert.equal(await page.getByRole('searchbox',{name:'Find fixture records',exact:true}).inputValue(),'Browser fixture 1');
 await page.getByRole('searchbox',{name:'Find fixture records',exact:true}).fill('');await page.keyboard.press('Escape');
 await page.evaluate(()=>{const main=document.querySelector('[data-workspace-main]');const spacer=document.createElement('div');spacer.id='page-scroll-fixture';spacer.style.height='500px';main.append(spacer);main.scrollTop=100;});
 await page.locator('[data-workspace-focused]').waitFor();
 assert.ok(await page.locator('[data-list]').evaluate(node=>node.getBoundingClientRect().top<2),'Page scrolling must also give the table the viewport');
 await page.evaluate(()=>document.getElementById('page-scroll-fixture').remove());
 await page.locator('[data-list]').focus();await page.keyboard.press('Home');await page.locator('[data-workspace-focused]').waitFor({state:'detached'});
 for(const width of [390,768,2400]){
  await page.setViewportSize({width,height:900});
  await page.waitForFunction(()=>document.querySelector('[data-list]').clientWidth>0);
  const widths=await geometry();assert.equal(widths[4],144);assert.equal(widths[6],256);
  assert.equal(await page.locator('[data-column-key=code]').isVisible(),true,'Narrow screens retain every column');
  assert.ok(await page.locator('[data-list]').evaluate(node=>node.querySelector('table').getBoundingClientRect().width>=node.clientWidth-1));
  if(width<1000){await page.locator('[data-list]').evaluate(node=>node.scrollLeft=node.scrollWidth);assert.ok(await page.locator('[data-list]').evaluate(node=>node.scrollLeft>0));}
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'Only the table may overflow horizontally');
 }
 await page.setViewportSize({width:390,height:844});
 await page.locator('[data-list]').evaluate(node=>{node.scrollLeft=0;node.scrollTop=1300;});
 await page.locator('[data-workspace-focused]').waitFor();
 const phone=await page.locator('[data-list]').boundingBox();assert.ok(phone.y<2&&phone.height>=842);
 await page.getByRole('button',{name:'Table options',exact:true}).click();
 await menu.waitFor({state:'visible'});await page.screenshot({path:join(out,'phone-options.png')});
 assert.equal(await menu.getByLabel('Fixture filter',{exact:true}).inputValue(),'Retain the typed filter');
 await menu.getByRole('button',{name:'Back to top',exact:true}).click();
 await page.locator('[data-workspace-focused]').waitFor({state:'detached'});
 await page.screenshot({path:join(out,'phone-top.png')});
 await page.evaluate(()=>document.documentElement.style.fontSize='175%');
 await page.waitForFunction(()=>Math.round(document.querySelector('[data-column-key=total]').getBoundingClientRect().width)===448);
 const zoomed=await page.locator('[data-row-index="0"] [data-label="Total"]').evaluate(cell=>cell.scrollWidth<=cell.clientWidth+1);
 assert.equal(zoomed,true,'App zoom must scale fixed fact widths with the font');
 await page.evaluate(()=>document.documentElement.style.fontSize='100%');
 await page.evaluate(()=>window.shortRows());
 await page.locator('[data-list]').evaluate(node=>node.scrollTop=120);await page.locator('[data-workspace-focused]').waitFor();
 await page.mouse.move(100,600);await page.mouse.wheel(0,-200);
 await page.locator('[data-workspace-focused]').waitFor({state:'detached'});
 await page.evaluate(()=>window.resetNames());
 await page.locator('[data-list]').evaluate(node=>node.scrollTop=900);await page.locator('[data-workspace-focused]').waitFor();
 await page.evaluate(()=>window.openLocal());
 const localDialog=page.getByRole('dialog',{name:'Fixture local dialog',exact:true});await localDialog.waitFor({state:'visible'});
 await localDialog.getByRole('heading',{name:'Local dialog heading',exact:true}).waitFor({state:'visible'});
 await localDialog.getByRole('button',{name:'Local action',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('[data-native-fixture]')?.dataset.columnLayout==='auto');
 assert.ok(await localDialog.getByLabel('Native date input',{exact:true}).evaluate(node=>node.scrollWidth<=node.clientWidth+1),'Native date editors must leave room for their picker button');
 assert.ok(await localDialog.getByLabel('Native amount input',{exact:true}).evaluate(node=>node.scrollWidth<=node.clientWidth+1),'Native figure editors must fit their fixed column');
 await localDialog.getByRole('button',{name:'Find local records',exact:true}).click();
 await localDialog.getByRole('searchbox',{name:'Find local records',exact:true}).fill('Browser fixture 1');
 assert.equal(await menu.getByRole('button',{name:'Local action',exact:true}).count(),0,'Dialog controls must never move into the page popup');
 await page.evaluate(()=>window.closeLocal());await localDialog.waitFor({state:'detached'});
 await page.evaluate(()=>window.dispatchEvent(new Event('beforeprint')));
 await page.getByRole('heading',{name:'Fixed table fixture',exact:true}).waitFor({state:'visible'});
 assert.equal(await page.locator('[data-row-index]').count(),2000,'Printing a focused table must include every row and restore its heading');
 await page.evaluate(()=>window.dispatchEvent(new Event('afterprint')));await page.locator('[data-workspace-focused]').waitFor();
 await page.evaluate(()=>window.dispatchEvent(new Event('fixture-navigation')));
 await page.locator('[data-workspace-focused]').waitFor({state:'detached'});
 assert.deepEqual(errors,[]);
 console.log('Fixed table browser checks passed: complete figures/dates, wrapped strings, stable widths, all mobile columns, viewport scrolling, circular options, retained filters/selection/actions, keyboard return, app zoom and route reset.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
