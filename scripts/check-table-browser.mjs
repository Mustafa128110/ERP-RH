import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import { createRequire } from "node:module";
import { build } from "esbuild";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const css = fs.readdirSync(".next/static/chunks").filter(file => file.endsWith(".css")).map(file => fs.readFileSync(`.next/static/chunks/${file}`, "utf8")).join("\n");
assert.ok(css.includes("mobile-data-list"), "run npm run build first to test the actual application styles");
const result = await build({ stdin: { contents: `
  import React, { useState } from 'react';
  import { createRoot } from 'react-dom/client';
  import { DataTable } from './components/ui/DataTable';
  const rows = Array.from({length:5000}, (_,i)=>({id:String(i),name:'Record '+String(i+1).padStart(5,'0'),amount:i+1}));
  const columns = [{key:'name',label:'Name'},{key:'amount',label:'Amount'}];
  function App() {
    const [selected,setSelected] = useState([]);
    return React.createElement(React.Fragment,null,
      React.createElement('output',{id:'selected'},selected.length),
      React.createElement('div',{style:{height:600,display:'flex',flexDirection:'column',minHeight:0}},React.createElement(DataTable,{rows,columns,idKey:'id',selected,onSelectedChange:setSelected,searchPlaceholder:'Find records'})));
  }
  createRoot(document.getElementById('root')).render(React.createElement(App));
`, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, platform: "browser", format: "iife", plugins: [{ name: "next-test-context", setup(build) {
  build.onResolve({ filter: /^next\/(navigation|link)$/ }, args => ({ path: args.path, namespace: "test-next" }));
  build.onLoad({ filter: /.*/, namespace: "test-next" }, args => ({ contents: args.path.endsWith("navigation") ? 'export const usePathname=()=>String.fromCharCode(47); export const useSearchParams=()=>new URLSearchParams(); export const useRouter=()=>({push(){}});' : 'import React from "react"; export default function Link(props){return React.createElement("a",props);}', resolveDir: process.cwd(), loader: "js" }));
} }] });
const server = http.createServer((request, response) => {
  if (request.url === "/app.js") { response.setHeader("Content-Type", "text/javascript"); response.end(result.outputFiles[0].text); }
  else if (request.url === "/style.css") { response.setHeader("Content-Type", "text/css"); response.end(css); }
  else { response.setHeader("Content-Type", "text/html"); response.end('<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/app.js"></script>'); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true, ...(process.env.ERP_BROWSER_EXECUTABLE ? { executablePath: process.env.ERP_BROWSER_EXECUTABLE } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator('[data-row-index="0"]').waitFor();
  const mounted = await page.locator("[data-row-index]").count();
  assert.ok(mounted < 100, `5000 records should need fewer than 100 mounted rows, got ${mounted}`);
  await page.getByRole("checkbox", { name: "Select all rows", exact: true }).check();
  assert.equal(await page.locator("#selected").textContent(), "5000", "select-all includes offscreen records");
  await page.locator("[data-list]").focus(); await page.keyboard.press("End");
  await page.locator('[data-row-index="4999"]').waitFor({ state: "visible" });
  assert.equal(await page.locator('[data-row-index="4999"]').getAttribute("data-focused"), "true", "End reaches the final record");
  await page.keyboard.press("/"); await page.getByPlaceholder("Find records").fill("Record 04999");
  await page.getByText("Record 04999", { exact: true }).waitFor();
  assert.equal(await page.locator("[data-row-index]").count(), 1, "search covers records that were offscreen");
  await page.getByPlaceholder("Find records").fill("");
  await page.getByRole("button", { name: "Show all rows at once" }).click();
  assert.equal(await page.locator("[data-row-index]").count(), 5000, "all-rows mode preserves browser find and accessibility");
  await page.getByRole("button", { name: "Use fast scrolling" }).click();
  await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
  assert.equal(await page.locator("[data-row-index]").count(), 5000, "printing includes every record");
  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("[data-list]").focus(); await page.keyboard.press("End");
  await page.locator('[data-row-index="4999"]').waitFor({ state: "visible" });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, "mobile cards must not overflow horizontally");
  assert.deepEqual(errors, []);
  console.log(`Table browser checks passed: ${mounted}/5000 rows mounted, full selection/search, final-row keyboard navigation, all-rows mode, complete printing and mobile reachability`);
} finally { await browser.close(); server.close(); }
