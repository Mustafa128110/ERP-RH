// Duplicate-protection verification for EVERY critical create action.
//
// Per flow (sale, purchase, payment batch, cash transfer, stock transfer,
// stock adjustment, inter-company, quotation, cheque batch, ledger entry):
//   1. open the create UI, fill one minimal record
//   2. arm the interceptor: the FIRST server-action POST that carries an
//      operationId is let through to the server (it COMMITS) but its response
//      is replaced with an HTTP 500, so the client believes the save failed
//   3. click Save -> the client must surface the failure and re-enable Save
//   4. click Save again with the SAME operationId -> the server must refuse
//      the replay with "already recorded"
//   5. the database is checked afterward (scripts/verify-db.mjs) for exactly
//      one logical transaction per flow, including related records
//
// Also implements the other failure cases:
//   MODE=never  -> the first POST is aborted before it reaches the server
//                  (Fetch.failRequest); the retry must then SUCCEED
//   MODE=double -> two synchronous Save clicks; exactly one must commit
//   MODE=reload -> Save once, let the server commit, reload the page; no
//                  duplicate and nothing silently resubmitted
//   MODE=rollback -> first attempt fails inside the transaction (duplicate
//                  cheque numbers); the retry with the same operationId must
//                  succeed (claim rolled back with the failed transaction)
//
// Usage: node --env-file=.env scripts/verify-flows.mjs
//   (requires dev server on :3050, Chrome on :9222, UI_TEST_EMAIL/PASSWORD)
import os from "node:os";
import fs from "node:fs";
import postgres from "postgres";

const CDP = "http://127.0.0.1:9222";
const APP = "http://localhost:3050";
const EMAIL = process.env.UI_TEST_EMAIL ?? "";
const PASSWORD = process.env.UI_TEST_PASSWORD ?? "";
const MODE = process.env.MODE ?? "drop";
const ONLY = (process.env.FLOWS ?? "").split(",").filter(Boolean);
const MARKER = `v${Date.now()}`;
const today = new Date().toLocaleDateString("en-CA");

const sql = postgres(process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL, { max: 2 });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- CDP plumbing -----------------------------------------------------------
const target = await (await fetch(`${CDP}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let id = 0;
const pending = new Map();
const issues = [];
let failArmed = false;
let failById = null;
// Request ids the harness itself failed (the dropped response of a committed
// save, or an aborted request) — their Network.loadingFailed events are the
// point of the test, not defects to report.
const droppedIds = new Set();

ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id) { pending.get(msg.id)?.resolve(msg); pending.delete(msg.id); return; }
  if (msg.method === "Runtime.exceptionThrown") {
    issues.push(`EXCEPTION: ${msg.params.exceptionDetails?.text} ${msg.params.exceptionDetails?.exception?.description ?? ""}`.trim());
  }
  // The harness itself fails every first create POST (the dropped response of a
  // committed save), which surfaces as a Fetch-type loadingFailed — the point
  // of the test, not a defect. The per-flow assertions (transport message,
  // replay refusal, DB state) are the real checks; this collector is only a
  // smoke signal for everything else.
  if (
    msg.method === "Network.loadingFailed" &&
    !droppedIds.has(msg.params.requestId) &&
    msg.params.canceled !== true &&
    msg.params.type !== "Image" &&
    msg.params.type !== "Fetch"
  ) {
    issues.push(`LOAD FAIL: ${msg.params.errorText}`);
  }
  if (msg.method === "Fetch.requestPaused") handlePaused(msg.params);
};

const send = (method, params = {}) =>
  new Promise((resolve, rej) => { const mid = ++id; pending.set(mid, { resolve, rej }); ws.send(JSON.stringify({ id: mid, method, params })); });

function handlePaused(params) {
  const req = params.request;
  const headers = Array.isArray(req?.headers) ? req.headers : Object.entries(req?.headers ?? {}).map(([name, value]) => ({ name, value }));
  const isNextAction = req?.method === "POST" && headers.some((h) => String(h.name).toLowerCase() === "next-action");
  // A create carries its operation id either as a form field (the page forms:
  // sale, purchase, transfer, …) or as a positional argument to a JS-called
  // server action (the batch dialogs: payments, cheques, expenses), where the
  // serialized body holds the UUID but never the word "operationId". Both
  // signal the same thing, so both arm the interceptor.
  const body = String(req?.postData ?? "");
  const bodyHasOp = body.includes("operationId") || /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.test(body);
  const stage = params.requestStage ?? (params.responseStatusCode !== undefined ? "Response" : "Request");
  const isCreate = isNextAction && bodyHasOp;

  if (stage === "Request") {
    if (isCreate && failArmed) {
      failArmed = false;
      if (MODE === "never") {
        // Case C: the request never reaches the server.
        droppedIds.add(params.requestId);
        void send("Fetch.failRequest", { requestId: params.requestId, errorReason: "Failed" });
        return;
      }
      failById = params.requestId;
    }
    if (process.env.DEBUG && req?.method === "POST") {
      console.log(`[REQ] ${req.url} op=${bodyHasOp} body=${String(req.postData ?? "").slice(0, 160)}`.replace(/\n/g, " "));
    }
    void send("Fetch.continueRequest", { requestId: params.requestId });
    return;
  }
  if (failById === params.requestId) {
    // Case A/B/D/E: the server already committed; the response is dropped on
    // the wire (the client sees a network failure, exactly like a lost packet).
    failById = null;
    droppedIds.add(params.requestId);
    if (process.env.DEBUG) console.log(`[RESP-DROPPED] ${params.requestId}`);
    void send("Fetch.failRequest", { requestId: params.requestId, errorReason: "Failed" });
    return;
  }
  if (process.env.DEBUG && stage === "Response") {
    console.log(`[RESP] ${params.requestId} status=${params.responseStatusCode}`);
  }
  void send("Fetch.continueResponse", { requestId: params.requestId });
}

// --- page helpers -----------------------------------------------------------
async function evaluate(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(`eval failed: ${r.result.exceptionDetails.text} — ${expression}`);
  return r.result?.result?.value;
}

async function waitExpr(expression, label, timeout = 60000, interval = 250) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await evaluate(expression)) return;
    await sleep(interval);
  }
  throw new Error(`timeout (${timeout}ms) waiting for ${label}`);
}

async function navigate(path) {
  await send("Page.navigate", { url: `${APP}${path}` });
  await waitExpr(`document.readyState === "complete"`, `load ${path}`, 120000);
}

// React-controlled inputs need the native setter + input/change events.
const INSTALL = `(() => {
  if (window.__vReady) return;
  window.__setVal = (sel, value) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  };
  window.__setSelect = (sel, value) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(el, value);
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  };
  // Pick the Nth option that has a real value (skips the disabled placeholder).
  window.__pickNth = (sel, n) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    const options = [...el.options].filter((o) => o.value && !o.disabled);
    const o = options[n];
    if (!o) return false;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(el, o.value);
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  };
  window.__click = (sel) => { const el = document.querySelector(sel); if (!el) return false; el.click(); return true; };
  window.__clickText = (text) => {
    const el = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === text);
    if (!el) return false; el.click(); return true;
  };
  window.__vReady = true;
})()`;

// --- flows ------------------------------------------------------------------
const flows = {
  sale: {
    path: "/sales",
    open: null, // the page IS the form
    openReady: `!!document.querySelector('input[data-cell="0-0"]')`,
    fill: (m) => `__setVal('input[data-cell="0-0"]', 'TI-sale-${m}'); __setVal('input[data-cell="0-2"]', '2'); __setVal('input[data-cell="0-4"]', '10.5');`,
    // The page's own form is the one carrying the operationId — the topbar's
    // Sign-out form has a submit button too, and it comes first in the DOM.
    submitSel: 'form:has(input[name="operationId"]) button[type="submit"]',
    submit: `__click('form:has(input[name="operationId"]) button[type="submit"]')`,
    afterFail: `(() => { const b = document.querySelector('form:has(input[name="operationId"]) button[type="submit"]'); return b && !b.disabled; })()`,
  },
  purchase: {
    path: "/purchases/stock",
    open: `__click('button[aria-label="New purchase"]')`,
    openReady: `!!document.querySelector('[role="dialog"] input[placeholder^="Pick a supplier"]')`,
    fill: () => `
      __setVal('[role="dialog"] input[placeholder^="Pick a supplier"]', 'SP-${m}');
      __setVal('[role="dialog"] input[placeholder^="Where the goods arrived"]', 'Shop');
      __setVal('[role="dialog"] table tbody tr:first-child input[role="combobox"]', 'TI-purchase-${m}');
      __setVal('[role="dialog"] table tbody tr:first-child input[placeholder="Qty"]', '1');
      __setVal('[role="dialog"] table tbody tr:first-child input[placeholder="Rate"]', '50');`,
    submitSel: '[role="dialog"] button[type="submit"]',
    submit: `__click('[role="dialog"] button[type="submit"]')`,
    afterFail: `(() => { const b = document.querySelector('[role="dialog"] button[type="submit"]'); return b && !b.disabled; })()`,
  },
  payment: {
    path: "/payments",
    open: `__click('button[aria-label="Add payments"]')`,
    openReady: `!!document.querySelector('[role="dialog"] input[role="combobox"]')`,
    fill: () => `
      __setVal('[role="dialog"] input[role="combobox"]', 'TP-${m}');
      __setVal('[role="dialog"] input[type="number"]', '33');`,
    submitSel: '[role="dialog"] [data-dialog-submit]',
    submit: `__click('[role="dialog"] [data-dialog-submit]')`,
    afterFail: `document.body.innerText.includes("Couldn't reach the server")`,
  },
  transfer: {
    path: "/inventory/stock-transfers",
    open: `__click('button[aria-label="New transfer"]')`,
    openReady: `!!document.querySelector('[role="dialog"] input[data-cell="0-0"]')`,
    fill: (m) => `
      __pickNth('select[name="fromLocationId"]', 0);
      __pickNth('select[name="toLocationId"]', 0);
      __setVal('[role="dialog"] input[data-cell="0-0"]', 'TI-transfer-${m}');
      __setVal('[role="dialog"] input[data-cell="0-2"]', '3');`,
    submitSel: '[role="dialog"] button[type="submit"]',
    submit: `__click('[role="dialog"] button[type="submit"]')`,
    afterFail: `(() => { const b = document.querySelector('[role="dialog"] button[type="submit"]'); return b && !b.disabled; })()`,
  },
  adjustment: {
    path: "/inventory/stock-adjustments",
    open: `__click('button[aria-label="New adjustment"]')`,
    openReady: `!!document.querySelector('[role="dialog"] input[data-cell="0-0"]')`,
    fill: (m) => `
      __pickNth('select[name="locationId"]', 0);
      __pickNth('select[name="reason"]', 0);
      __setVal('[role="dialog"] input[data-cell="0-0"]', 'TI-adjust-${m}');
      __setVal('[role="dialog"] input[data-cell="0-2"]', '-1');`,
    submitSel: '[role="dialog"] button[type="submit"]',
    submit: `__click('[role="dialog"] button[type="submit"]')`,
    afterFail: `(() => { const b = document.querySelector('[role="dialog"] button[type="submit"]'); return b && !b.disabled; })()`,
  },
  intercompany: {
    path: "/inventory/inter-company",
    open: `__click('button[aria-label="New inter-company sale"]')`,
    openReady: `!!document.querySelector('[role="dialog"] input[data-cell="0-0"]')`,
    fill: (m) => `
      __pickNth('select[name="buyerCompanyId"]', 0);
      __pickNth('select[name="fromLocationId"]', 0);
      __pickNth('select[name="toLocationId"]', 1);
      __setVal('[role="dialog"] input[data-cell="0-0"]', 'TI-ic-${m}');
      __setVal('[role="dialog"] input[data-cell="0-2"]', '1');
      __setVal('[role="dialog"] input[data-cell="0-3"]', '10');`,
    submitSel: '[role="dialog"] button[type="submit"]',
    submit: `__click('[role="dialog"] button[type="submit"]')`,
    afterFail: `(() => { const b = document.querySelector('[role="dialog"] button[type="submit"]'); return b && !b.disabled; })()`,
  },
  quotation: {
    path: "/sales/quotations",
    open: `__click('button[aria-label="New quotation"]')`,
    openReady: `!!document.querySelector('[role="dialog"] input[data-cell="0-0"]')`,
    fill: (m) => `
      __setVal('[role="dialog"] input[placeholder^="Pick or type a new customer"]', 'TQ-${m}');
      __setVal('[role="dialog"] input[data-cell="0-0"]', 'TI-quote-${m}');
      __setVal('[role="dialog"] input[data-cell="0-2"]', '1');
      __setVal('[role="dialog"] input[data-cell="0-3"]', '20');`,
    submitSel: '[role="dialog"] button[type="submit"]',
    submit: `__click('[role="dialog"] button[type="submit"]')`,
    afterFail: `(() => { const b = document.querySelector('[role="dialog"] button[type="submit"]'); return b && !b.disabled; })()`,
  },
  cheque: {
    path: "/accounts",
    // The tab and the add button must not race: switch to Cheques, wait until
    // the tab is actually active, then open the add dialog — otherwise the
    // Alt+N button still opens the previous tab's dialog (cash accounts).
    open: `(async () => {
      const tab = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Cheques");
      if (!tab) return;
      tab.click();
      for (let i = 0; i < 40 && !tab.classList.contains("border-navy-800"); i++) await new Promise((r) => setTimeout(r, 100));
      document.querySelector('button[title*="Alt+N"]').click();
    })()`,
    openReady: `!!document.querySelector('[role="dialog"] input[type="number"]')`,
    fill: (m) => `
      __setVal('[role="dialog"] table tbody tr:first-child input:not([type]):not([role="combobox"])', 'TC-${m}');
      __setVal('[role="dialog"] table tbody tr:first-child input[type="date"]', '${today}');
      __setVal('[role="dialog"] input[type="number"]', '15');`,
    submitSel: '[role="dialog"] [data-dialog-submit]',
    submit: `__click('[role="dialog"] [data-dialog-submit]')`,
    afterFail: `document.body.innerText.includes("Couldn't reach the server")`,
  },
  ledger: {
    path: "/ledger",
    open: `__click('button[aria-label="Add ledger entry"]')`,
    openReady: `!!document.querySelector('[role="dialog"] input[placeholder^="Pick a contact"]')`,
    fill: (m) => `
      __setVal('[role="dialog"] input[placeholder^="Pick a contact"]', 'TL-${m}');
      __setVal('[role="dialog"] input[name="amount"]', '77');
      __setVal('[role="dialog"] input[name="note"]', 'ledger-test-${m}');`,
    // The amount and note are uncontrolled (defaultValue) inputs, and a form
    // action completion resets them to their defaults — after the first
    // (lost-response) attempt they're blank, exactly as a real user would see
    // them. Re-typing them is what a real user does before clicking Save again,
    // and it is what lets the server-side duplicate refusal actually fire.
    refill: () => `
      __setVal('[role="dialog"] input[name="amount"]', '77');
      __setVal('[role="dialog"] input[name="note"]', 'ledger-test-${m}');`,
    submitSel: '[role="dialog"] button[type="submit"]',
    submit: `__click('[role="dialog"] button[type="submit"]')`,
    afterFail: `(() => { const b = document.querySelector('[role="dialog"] button[type="submit"]'); return b && !b.disabled; })()`,
  },
  cashtransfer: {
    path: "/accounts",
    // Same tab-switch race as the cheque flow: wait for the Transfers tab to
    // be active before the Alt+N button opens its dialog.
    open: `(async () => {
      const tab = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Transfers");
      if (!tab) return;
      tab.click();
      for (let i = 0; i < 40 && !tab.classList.contains("border-navy-800"); i++) await new Promise((r) => setTimeout(r, 100));
      document.querySelector('button[title*="Alt+N"]').click();
    })()`,
    openReady: `!!document.querySelector('[role="dialog"] select[name="fromAccount"]')`,
    fill: () => `
      __pickNth('select[name="fromAccount"]', 0);
      __pickNth('select[name="toAccount"]', 0);
      __setVal('[role="dialog"] input[name="amount"]', '21');`,
    // toAccount and amount are uncontrolled inputs, wiped by the action
    // completion after the lost response — re-pick/re-type before the replay.
    refill: () => `
      __pickNth('select[name="toAccount"]', 0);
      __setVal('[role="dialog"] input[name="amount"]', '21');`,
    submitSel: '[role="dialog"] button[type="submit"]',
    submit: `__click('[role="dialog"] button[type="submit"]')`,
    afterFail: `(() => { const b = document.querySelector('[role="dialog"] button[type="submit"]'); return b && !b.disabled; })()`,
  },
};

async function runFlow(name, flow) {
  console.log(`\n=== ${name} (mode ${MODE}) ===`);
  const marker = `${name}-${MARKER}`;

  await navigate(flow.path);
  await evaluate(INSTALL);
  // React hydrates after the DOM is complete; clicking or filling before the
  // event system is attached silently drops the interaction. Give the page a
  // beat to settle before the open button is clicked.
  await sleep(1500);
  if (flow.open) {
    await evaluate(flow.open);
    await waitExpr(flow.openReady, `${name} open`, 60000);
  } else {
    await waitExpr(flow.openReady, `${name} form`, 60000);
  }
  // A dialog opening is its own hydration — the grid inputs inside it need a
  // moment before the fill events will land.
  await sleep(1500);
  await evaluate(flow.fill(marker));
  await sleep(500);
  if (process.env.DEBUG) {
    console.log(
      "form state:",
      await evaluate(`(() => {
        const f = document.querySelector('[role="dialog"] form, form:has(input[name="operationId"])');
        if (!f) return "no form";
        const read = (n) => f.querySelector('[name="' + n + '"]')?.value;
        return JSON.stringify({
          op: (read("operationId") ?? "").slice(0, 8),
          company: (read("companyId") ?? "").slice(0, 8),
          cash: (read("cashAccountId") ?? "").slice(0, 8),
          paid: read("paidAmount"),
          lines: (read("linesJson") ?? "").slice(0, 200),
        });
      })()`),
    );
  }

  // A popup flow closes its dialog the moment a save succeeds; a page flow
  // shows a "created"/"posted" message. Both mean the save landed, which is
  // what the wait after a retry needs to detect.
  const SUCCESS_SEEN = `!document.querySelector('[role="dialog"]') || document.body.innerText.includes("created") || document.body.innerText.includes("posted")`;

  if (MODE === "reload") {
    // Case E: save once, the server commits, then the page goes away before the
    // client sees the result. Nothing may resubmit afterwards.
    failArmed = true;
    await evaluate(flow.submit);
    await sleep(4000);
    await navigate(flow.path);
    await sleep(1500);
    console.log(`${name}: save sent, page reloaded, nothing resubmitted`);
    return { name, mode: MODE, marker };
  }

  if (MODE === "double") {
    // Case D: two clicks in the same tick, same operationId. The server
    // serialises the race — one claim wins, the other is refused. The winning
    // save may close the dialog before the refusal ever renders, so "resolved"
    // means the success path OR the duplicate message.
    await evaluate(`(() => { const b = document.querySelector(${JSON.stringify(flow.submitSel)}); b.click(); b.click(); })()`);
    await waitExpr(`document.body.innerText.includes("already recorded") || ${SUCCESS_SEEN}`, "double-click resolution", 30000);
    await sleep(2000);
    console.log(`${name}: double-click resolved (DB check confirms one transaction)`);
    return { name, mode: MODE, marker };
  }

  // Case A (drop) and Case C (never) both begin with a first attempt whose
  // result the browser never sees: A commits server-side then loses the
  // response, C is aborted before it leaves.
  failArmed = true;
  await evaluate(flow.submit);

  // A completed form action resets a form's uncontrolled fields to their
  // defaults, so a flow whose form has any (the ledger's amount/note) must
  // re-type them before the next click — the same thing a real user does.
  const refill = () => (flow.refill ? evaluate(flow.refill(marker)) : Promise.resolve());

  if (MODE === "never") {
    // Case C: the request never reached the server, so nothing was written and
    // the retry with the same operationId must SUCCEED.
    await waitExpr(flow.afterFail, `${name} re-enabled after aborted request`, 40000);
    console.log(`${name}: first request aborted before the server, Save re-enabled`);
    await refill();
    await evaluate(flow.submit);
    await waitExpr(SUCCESS_SEEN, `${name} retry succeeded`, 40000);
    console.log(`${name}: retry succeeded — nothing had been written`);
    return { name, mode: MODE, marker };
  }

  // Case A: commit server-side, drop the response, then replay.
  await waitExpr(flow.afterFail, `${name} re-enabled after lost response`, 40000);
  console.log(`${name}: first save committed, response lost, Save re-enabled`);

  await refill();
  await evaluate(flow.submit); // same operationId
  await waitExpr(`document.body.innerText.includes("already recorded")`, `${name} replay refused`, 40000);
  console.log(`${name}: replay refused with the duplicate message`);
  return { name, mode: MODE, marker };
}

// --- run --------------------------------------------------------------------
try {
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");
  await send("Fetch.enable", {
    patterns: [
      { urlPattern: "*", requestStage: "Request" },
      { urlPattern: "*", requestStage: "Response" },
    ],
  });
  await send("Network.clearBrowserCookies");
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

  if (!EMAIL || !PASSWORD) throw new Error("UI_TEST_EMAIL / UI_TEST_PASSWORD env vars required");

  await navigate("/login");
  await waitExpr(`!!document.querySelector('input[name="email"]')`, "login form");
  await evaluate(INSTALL);
  await evaluate(`__setVal('input[name="email"]', ${JSON.stringify(EMAIL)}); __setVal('input[name="password"]', ${JSON.stringify(PASSWORD)}); document.querySelector("form").requestSubmit()`);
  await waitExpr(`location.pathname !== "/login"`, "post-login redirect", 30000);
  console.log(`logged in as ${EMAIL} → ${await evaluate("location.pathname")}`);

  // The cash-transfer flow has no marker of its own in the database — its two
  // documents are found by reason — so its before-counts are taken here, before
  // any flow runs, and verify-db compares the after-state against them. Filtered
  // on the app's local today (not the database's current_date, which runs in the
  // server's timezone and can be a day behind).
  const transferOutBefore = (await sql`select count(*)::int as n from documents where reason like 'Cash Transfer out %' and document_date = ${today}`)[0].n;
  const transferInBefore = (await sql`select count(*)::int as n from documents where reason like 'Cash Transfer in %' and document_date = ${today}`)[0].n;

  const names = ONLY.length ? ONLY : Object.keys(flows);
  const results = [];
  for (const n of names) {
    if (!flows[n]) throw new Error(`unknown flow "${n}"`);
    const r = await runFlow(n, flows[n]);
    results.push(r);
  }

  const out = {
    marker: MARKER,
    mode: MODE,
    results,
    today,
    transferOutBefore,
    transferInBefore,
  };
  const file = `${os.tmpdir()}/erp-verify.json`;
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`\nresults written to ${file}`);

  console.log(issues.length === 0 ? "\nNO NETWORK / EXCEPTION ISSUES" : `\n${issues.length} ISSUE(S):`);
  for (const i of issues) console.log("  " + i);
  process.exit(issues.length === 0 ? 0 : 2);
} catch (e) {
  console.error("\nFAILED:", e.message);
  process.exit(1);
}
