import assert from 'node:assert/strict';
import http from 'node:http';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const baseline=execFileSync('git',['show','ad36a3b:components/ui/ComboBox.tsx'],{encoding:'utf8',windowsHide:true});
const css=readdirSync('.next/static/chunks').filter(file=>file.endsWith('.css')).map(file=>readFileSync(`.next/static/chunks/${file}`,'utf8')).join('\n');
const bundle=await build({stdin:{contents:`
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
import {ComboBox} from './components/ui/ComboBox';import {ComboBox as Old} from 'baseline-picker';
const options=Array.from({length:10000},(_,n)=>({id:String(n),name:'Product '+String(n+1).padStart(5,'0')}));
let root;window.mount=old=>{root?.unmount();root=createRoot(document.getElementById('root'));function Fields(){const [value,setValue]=useState('');return React.createElement(old?Old:ComboBox,{value,onChange:setValue,options,placeholder:'Choose product',className:'w-full'})}flushSync(()=>root.render(<Fields/>))};
`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,jsx:"automatic",write:false,platform:'browser',format:'iife',plugins:[{name:'baseline',setup(builder){builder.onResolve({filter:/^baseline-picker$/},()=>({path:'baseline',namespace:'baseline'}));builder.onLoad({filter:/.*/,namespace:'baseline'},()=>({contents:baseline,loader:'tsx',resolveDir:process.cwd()}));}}]});
const server=http.createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':req.url==='/style.css'?'text/css':'text/html');res.end(req.url==='/app.js'?bundle.outputFiles[0].text:req.url==='/style.css'?css:'<!doctype html><link rel="stylesheet" href="/style.css"><div id="root" style="width:400px;margin:24px"></div><script src="/app.js"></script>')});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,...(process.env.ERP_BROWSER_EXECUTABLE?{executablePath:process.env.ERP_BROWSER_EXECUTABLE}:{})});
try{
 const page=await browser.newPage({viewport:{width:1280,height:800}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 const measurements={baseline:[],optimized:[]};
 for(const old of [true,false])for(let n=0;n<5;n++){
  await page.evaluate(old=>window.mount(old),old);
  assert.deepEqual(errors,[]);
  const ms=await page.evaluate(()=>new Promise(resolve=>{const start=performance.now();document.querySelector('input').click();requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(performance.now()-start)))}));
  measurements[old?'baseline':'optimized'].push(ms);
 }
 const mounted=await page.locator('ul button').count();assert.ok(mounted<25);
 await page.locator('ul').evaluate(list=>{list.scrollTop=list.scrollHeight});
 await page.getByRole('option',{name:'Product 10000',exact:true}).waitFor();
 await page.getByRole('option',{name:'Product 10000',exact:true}).click();
 assert.equal(await page.getByPlaceholder('Choose product').inputValue(),'Product 10000');
 await page.getByPlaceholder('Choose product').fill('Product 09999');
 await page.getByRole('option',{name:'Product 09999',exact:true}).waitFor();
 await page.keyboard.press('Enter');assert.equal(await page.getByPlaceholder('Choose product').inputValue(),'Product 09999');
 await page.getByPlaceholder('Choose product').fill('');
 for(let n=0;n<35;n++)await page.keyboard.press('ArrowDown');
 await page.keyboard.press('Enter');assert.equal(await page.getByPlaceholder('Choose product').inputValue(),'Product 00036');
 assert.deepEqual(errors,[]);
 const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
 const report={measuredAt:new Date().toISOString(),browser:browser.version(),options:10000,mounted,baselineCommit:'ad36a3b',millisecondsToTwoAnimationFrames:measurements,medianBaseline:median(measurements.baseline),medianOptimized:median(measurements.optimized)};
 writeFileSync('docs/picker-performance.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close();server.close()}
