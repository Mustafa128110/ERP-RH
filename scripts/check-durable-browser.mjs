import assert from "node:assert/strict";
import http from "node:http";
import { createRequire } from "node:module";
import { build } from "esbuild";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const bundled = await build({ stdin: { contents: `
  import * as store from './lib/command-store';
  import * as client from './lib/background-client';
  import * as user from './lib/client-user';
  import * as sync from './lib/command-sync';
  import * as draft from './lib/draft';
  import React, { useState } from 'react';
  import { createRoot } from 'react-dom/client';
  import { useDraft } from './components/ui/useDraft';
  import { RecordEditRecovery } from './components/ui/RecordEditRecovery';
  function DraftProbe() {
    const [value, setValue] = useState('');
    const saved = useDraft('probe', { state: { value }, enabled: true, hasContent: value => !!value.value, apply: value => setValue(value.value) });
    return React.createElement('div', null,
      React.createElement('button', { id: 'restore', onClick: saved.restore, disabled: !saved.offerDraft }, 'Restore'),
      React.createElement('fieldset', { disabled: saved.offerDraft }, React.createElement('input', { id: 'draft-value', value, onChange: event => setValue(event.target.value) })));
  }
  window.mountDraft = () => createRoot(document.getElementById('probe')).render(React.createElement(DraftProbe));
  let recordRoot;
  window.mountRecord = (id, revision) => {
    recordRoot?.unmount();
    recordRoot = createRoot(document.getElementById('record-probe'));
    recordRoot.render(React.createElement(RecordEditRecovery, { domain: 'brands', record: { id, _revision: revision } },
      React.createElement('form', null,
        React.createElement('input', {id:'record-name', name:'name', defaultValue:'Original'}),
        React.createElement('input', {id:'record-active', name:'isActive', type:'checkbox', defaultChecked:true}),
        React.createElement('input', {id:'record-secret', name:'password', type:'password', defaultValue:'never-persist'}))));
  };
  window.work = { ...store, ...client, ...user, ...sync, ...draft };
`, resolveDir: process.cwd(), loader: "ts" }, bundle: true, write: false, platform: "browser", format: "iife" });
const server = http.createServer((request, response) => {
  response.setHeader("Content-Type", request.url === "/work.js" ? "text/javascript" : "text/html");
  response.end(request.url === "/work.js" ? bundled.outputFiles[0].text : '<!doctype html><button id="activate">Activate</button><div id="probe"></div><div id="record-probe"></div><script src="/work.js"></script>');
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true, ...(process.env.ERP_BROWSER_EXECUTABLE ? { executablePath: process.env.ERP_BROWSER_EXECUTABLE } : {}) });
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  const url = `http://127.0.0.1:${server.address().port}`;
  await page.goto(url);
  await page.evaluate(() => {
    work.saveDraft("probe", { value: "Original unsaved sale" });
    window.mountDraft();
  });
  await page.locator("#restore:enabled").waitFor();
  assert.equal(await page.locator("#draft-value").isDisabled(), true, "a new form cannot overwrite a draft while its restore choice is pending");
  assert.equal(await page.evaluate(() => work.readDraft("probe").value), "Original unsaved sale", "mount effects preserve the previous draft");
  await page.click("#restore");
  assert.equal(await page.inputValue("#draft-value"), "Original unsaved sale");
  await page.fill("#draft-value", "Continued sale");
  assert.equal(await page.evaluate(() => work.readDraft("probe").value), "Continued sale");
  const id = await page.evaluate(async () => {
    work.setClientUserId("user-a");
    const form = new FormData(); form.set("contactName", "Test customer"); form.set("linesJson", '[{"quantity":"2","unitPrice":"10"}]');
    const result = await work.queueBackgroundAction("sales.createSale", [null, form]);
    if (!result.queued) throw new Error(JSON.stringify(result));
    const rows = await work.listCommands("user-a");
    if (rows.length !== 1 || rows[0].id !== result.operationId) throw new Error("Acknowledgement preceded durable storage");
    return result.operationId;
  });
  await context.setOffline(true);
  assert.equal(await page.evaluate(async () => (await work.listCommands("user-a"))[0].id), id);
  await context.setOffline(false);
  await page.reload();
  assert.equal(await page.evaluate(async () => (await work.listCommands("user-a"))[0].id), id, "the queue survives full reload");
  const second = await context.newPage(); await second.goto(url);
  assert.equal(await second.evaluate(async () => (await work.listCommands("user-a"))[0].id), id, "another tab sees the same committed input");
  assert.equal(await page.evaluate(async () => (await work.listCommands("user-b")).length), 0, "another account cannot see the queue");
  await page.evaluate(async id => {
    const [entry] = await work.listCommands("user-a");
    await work.addCommand(entry);
    if ((await work.listCommands("user-a")).length !== 1) throw new Error("A repeated local handoff duplicated the entry");
    let refused = false;
    try { await work.addCommand({ ...entry, args: [{ amount: "different" }] }); } catch { refused = true; }
    if (!refused || (await work.listCommands("user-a"))[0].args[1].$form[0][1] !== "Test customer") throw new Error("A duplicate ID overwrote saved input");
    await work.changeCommand("user-b", id, row => ({ ...row, status: "discarded" }));
    if ((await work.listCommands("user-a"))[0].status !== "pending") throw new Error("Cross-account mutation succeeded");
  }, id);
  const original = await page.evaluate(async () => {
    work.setClientUserId("user-a");
    const original = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function(...args) {
      if (args[1] === "readwrite") throw new DOMException("Storage quota exceeded", "QuotaExceededError");
      return original.apply(this, args);
    };
    const result = await work.queueBackgroundAction("sales.createSale", [null, new FormData()]);
    IDBDatabase.prototype.transaction = original;
    return { error: result.error, queued: !!result.queued, count: (await work.listCommands("user-a")).length };
  });
  assert.equal(original.queued, false); assert.ok(original.error); assert.equal(original.count, 1, "quota failure must not acknowledge or replace input");
  await page.click("#activate");
  await page.evaluate(() => { window.addEventListener("beforeunload", event => work.warnBeforeUnload(event, true)); });
  let warned = false;
  page.once("dialog", async dialog => { warned = dialog.type() === "beforeunload"; await dialog.accept(); });
  await page.reload();
  assert.equal(warned, true, "refresh must produce the native warning after user interaction");
  assert.equal(await page.evaluate(async () => (await work.listCommands("user-a"))[0].id), id, "accepting refresh still preserves the queue");
  await page.evaluate(async () => {
    work.setClientUserId("revision-check");
    const target = crypto.randomUUID();
    work.rememberRevisions({ [`documents:${target}`]: "100" });
    const editor = document.createElement("form");
    editor.dataset.commandRecord = target;
    document.body.append(editor);
    work.rememberRevisions({ [`documents:${target}`]: "101" });
    const first = await work.queueBackgroundAction("sales.updateSale", [target, null, new FormData()]);
    const rows = await work.listCommands("revision-check");
    if (rows.find(row => row.id === first.operationId).revisions[`documents:${target}`] !== "100") throw new Error("Hover replaced an open editor's base version");
    editor.remove();
    work.rememberRevisions({ [`documents:${target}`]: "102" });
    const next = await work.queueBackgroundAction("sales.updateSale", [target, null, new FormData()]);
    const fresh = (await work.listCommands("revision-check")).find(row => row.id === next.operationId);
    if (fresh.revisions[`documents:${target}`] !== "102") throw new Error("A freshly opened editor retained an obsolete base version");
  });
  const recordId = await page.evaluate(() => { work.setClientUserId('master-check'); const id=crypto.randomUUID(); window.mountRecord(id,'200'); return id; });
  await page.fill('#record-name', 'Recovered brand');
  await page.uncheck('#record-active');
  const saved = await page.evaluate(id => work.readDraft(`edit:master-check:brands:${id}`), recordId);
  assert.deepEqual(saved, {revision:'200', fields:[['name','Recovered brand']]}, 'edit recovery preserves unchecked fields and excludes passwords');
  await page.evaluate(id => window.mountRecord(id,'200'), recordId);
  await page.getByRole('button', {name:'Restore edit', exact:true}).waitFor();
  assert.equal(await page.locator('#record-name').isDisabled(), true);
  await page.getByRole('button', {name:'Restore edit', exact:true}).click();
  assert.equal(await page.inputValue('#record-name'), 'Recovered brand');
  assert.equal(await page.isChecked('#record-active'), false);
  await page.evaluate(id => window.mountRecord(id,'201'), recordId);
  await page.getByText('This record changed since your unsaved edit.', {exact:false}).waitFor();
  assert.equal(await page.getByRole('button', {name:'Restore edit', exact:true}).count(), 0, 'stale recovery cannot overwrite a newer base');
  await page.getByRole('button', {name:'Discard edit', exact:true}).click();
  await page.fill('#record-name', 'Reviewed brand');
  const queued = await page.evaluate(async id => {
    const key=`edit:master-check:brands:${id}`;const identity=work.draftOperationId(key);
    const result=await work.queueBackgroundAction('brands.updateBrand',[id,null,new FormData(document.querySelector('#record-name').form)]);
    const entry=(await work.listCommands('master-check')).find(row=>row.id===result.operationId);
    return {identity,entry,draft:work.readDraft(key)};
  }, recordId);
  assert.equal(queued.entry.id, queued.identity);
  assert.equal(queued.entry.revisions[`brands:${recordId}`], '201', 'server-rendered editor revision travels with the durable command');
  assert.equal(queued.draft, null, 'edit draft clears only after the durable handoff');
  await page.fill('#record-name', 'Keep this edit if deletion fails');
  const afterDelete = await page.evaluate(async id => {
    const form=new FormData();form.set('brandId',id);
    await work.queueBackgroundAction('brands.deleteBrand',[null,form]);
    return work.readDraft(`edit:master-check:brands:${id}`);
  }, recordId);
  assert.equal(afterDelete.fields[0][1], 'Keep this edit if deletion fails', 'a queued deletion must not erase unsubmitted edit fields');
  console.log("Browser durability checks passed, including master edit recovery, secret exclusion, stale recovery protection and revision-aware queue handoff");
} finally { await browser.close(); server.close(); }
