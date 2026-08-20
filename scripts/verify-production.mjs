// Production verification harness for the offline system (see PRODUCTION_RUNBOOK.md).
//
// Drives a real Chrome (CDP on :9222, the same contract as verify-offline.mjs
// and verify-flows.mjs) against the DEPLOYED application and walks the offline
// matrix that localhost cannot prove:
//
//   A  login                      F  queue quotation offline
//   B  service-worker installed   G  queue expense offline
//   C  offline reload             H  queue payment offline
//   D  (browser close/reopen      I  restart with pending work
//      — MANUAL, runbook §3)      J  reconnect + drain
//   E  offline readiness          K  DB exactly-once (optional)
//                                 L  lost-response retry (live form)
//                                 M  transient failure (offline bounce, phases F–J)
//                                 N  permanent failure → FAILED, recoverable
//                                 O  cancelled archive: cancel → restore → delete
//                                 P  logout with pending work
//                                 Q  cancel-restore (phase O)
//                                 R  User A → User B isolation
//                                 S  SW update across a deployment — MANUAL (§8)
//
// Financial safety: every record the script creates carries a unique marker
// (PQC-/PEC-/POC-/PLR-/PLI-<timestamp>) and — because UI_TEST_COMPANY is
// required — lands in a company you designate as the test company. The
// quotation can be deleted from the UI afterwards; committed expenses/payments
// are financial history and are left in place, identifiable by their marker
// (see the runbook's cleanup section). The script refuses to run its mutation
// phases without UI_TEST_COMPANY and refuses to queue into a company the picker
// does not offer.
//
// Environment:
//   PROD_URL                https://<your-deployment>  (required)
//   UI_TEST_EMAIL/PASSWORD  the test user              (required)
//   UI_TEST_EMAIL2/PASSWORD2 a second user             (required for phase R)
//   UI_TEST_COMPANY         substring of the test company's name (required for
//                           every phase that creates records)
//   DATABASE_URL_DIRECT     enables phase K (exactly-once DB proof)
//   SKIP                    comma list of phases to skip: sw,readiness,
//                           offline-queue,offline-reload,lost-response,
//                           permanent-failure,cancel-restore,logout-isolation
//
// Run:  node --env-file=.env scripts/verify-production.mjs
//   (Chrome must be running with --remote-debugging-port=9222, like the other
//   verify scripts; the DB phase additionally needs network access to the DB.)
import os from "node:os";
import fs from "node:fs";
import postgres from "postgres";

const CDP = "http://127.0.0.1:9222";
const APP = (process.env.PROD_URL ?? "").replace(/\/$/, "");
const EMAIL = process.env.UI_TEST_EMAIL ?? "";
const PASSWORD = process.env.UI_TEST_PASSWORD ?? "";
const EMAIL2 = process.env.UI_TEST_EMAIL2 ?? "";
const PASSWORD2 = process.env.UI_TEST_PASSWORD2 ?? "";
const TEST_COMPANY = process.env.UI_TEST_COMPANY ?? "";
const DB_URL = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL ?? "";
const SKIP = new Set((process.env.SKIP ?? "").split(",").map((s) => s.trim()).filter(Boolean));
const MARKER = `P${Date.now()}`;
const today = new Date().toLocaleDateString("en-CA");

if (!APP) throw new Error("PROD_URL is required — point this at the deployed application.");
if (!EMAIL || !PASSWORD) throw new Error("UI_TEST_EMAIL / UI_TEST_PASSWORD are required.");

const sql = DB_URL ? postgres(DB_URL, { max: 2 }) : null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- CDP plumbing (same contract as the other verify scripts) ---------------
const target = await (await fetch(`${CDP}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let id = 0;
const pending = new Map();
const issues = [];
let offline = false;
let offlinePosts = 0;
// Lost-response interception: armed for phase L only.
let failArmed = false;
let failById = null;
const droppedIds = new Set();

ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id) { pending.get(msg.id)?.resolve(msg); pending.delete(msg.id); return; }
  if (msg.method === "Runtime.exceptionThrown") {
    issues.push(`EXCEPTION: ${msg.params.exceptionDetails?.text} ${msg.params.exceptionDetails?.exception?.description ?? ""}`.trim());
  }
  // A real server-action POST while the network is emulated offline must not
  // happen — the queue holds the work instead.
  if (
    msg.method === "Network.requestWillBeSent" &&
    msg.params.request?.method === "POST" &&
    offline &&
    msg.params.request.headers?.["Next-Action"]
  ) {
    offlinePosts += 1;
    console.log(`[OFFLINE POST] ${msg.params.request.url} body=${String(msg.params.request.postData ?? "").slice(0, 120)}`);
  }
  if (msg.method === "Network.loadingFailed" && !droppedIds.has(msg.params.requestId) && msg.params.canceled !== true && msg.params.type !== "Image" && msg.params.type !== "Fetch") {
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
  const body = String(req?.postData ?? "");
  const bodyHasOp = body.includes("operationId") || /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.test(body);
  const stage = params.requestStage ?? (params.responseStatusCode !== undefined ? "Response" : "Request");
  const isCreate = isNextAction && bodyHasOp;

  if (stage === "Request") {
    if (isCreate && failArmed) {
      failArmed = false;
      failById = params.requestId;
    }
    void send("Fetch.continueRequest", { requestId: params.requestId });
    return;
  }
  if (failById === params.requestId) {
    // The server committed; the response is dropped on the wire — exactly a
    // lost packet. The client must surface a transport error, and the replay
    // with the same operationId must be refused as a duplicate.
    failById = null;
    droppedIds.add(params.requestId);
    void send("Fetch.failRequest", { requestId: params.requestId, errorReason: "Failed" });
    return;
  }
  void send("Fetch.continueResponse", { requestId: params.requestId });
}

async function evaluate(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) {
    const d = r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text;
    throw new Error(`eval failed: ${d} — ${expression}`);
  }
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
  for (let i = 0; i < 20; i++) {
    await evaluate(INSTALL);
    if (await evaluate(`typeof window.__click === 'function'`)) return;
    await sleep(500);
  }
  throw new Error(`window helpers never installed on ${path}`);
}

async function setOffline(value) {
  offline = value;
  await send("Network.emulateNetworkConditions", {
    offline: value,
    latency: 0,
    downloadThroughput: value ? 0 : -1,
    uploadThroughput: value ? 0 : -1,
  });
  await sleep(1500); // let the online/offline events settle in the provider
}

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
  // Select the option (anywhere in the dialog) whose text contains the given
  // substring — the company pickers carry no name attribute, so this is how
  // the harness aims every create at the designated test company.
  window.__pickCompany = (text) => {
    const dialogs = document.querySelectorAll('[role="dialog"]');
    for (const scope of dialogs.length ? dialogs : [document]) {
      for (const el of scope.querySelectorAll("select")) {
        const hit = [...el.options].find((o) => o.textContent.toLowerCase().includes(text.toLowerCase()));
        if (hit && hit.value) {
          Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(el, hit.value);
          el.dispatchEvent(new Event("change", { bubbles: true }));
          return hit.value;
        }
      }
    }
    return null;
  };
  window.__click = (sel) => { const el = document.querySelector(sel); if (!el) return false; el.click(); return true; };
  window.__clickText = (text) => {
    const el = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === text);
    if (!el) return false; el.click(); return true;
  };
  window.__vReady = true;
})()`;

// --- shared expressions ------------------------------------------------------
const READINESS_CACHED = `(() => {
  const uid = Object.keys(localStorage).map((k) => k.match(/^erp-cache:v1:([^:]+):/)?.[1]).filter(Boolean)[0];
  if (!uid) return null;
  const kinds = ['companies','customers','items','units','expenseCategories','contacts','bankAccounts','cashAccounts','cheques'];
  return { uid, missing: kinds.filter((k) => localStorage.getItem('erp-cache:v1:' + uid + ':' + k) === null) };
})()`;

const OUTBOX_SUMMARY = `(() => {
  const k = Object.keys(localStorage).find((x) => x.startsWith('erp-outbox:'));
  if (!k) return { uid: null, entries: [] };
  try {
    const es = JSON.parse(localStorage.getItem(k) || '[]');
    return { uid: k.slice('erp-outbox:'.length), entries: es.map((e) => ({ id: e.id, kind: e.kind, status: e.status, label: e.label, lastError: e.lastError ?? null })) };
  } catch { return { uid: k.slice('erp-outbox:'.length), entries: [] }; }
})()`;

const outboxSummary = () => evaluate(OUTBOX_SUMMARY);

// Click the tray button whose row (an <li> inside the tray) shows `label` and
// whose text is exactly `buttonText`. Null-safe.
const TRAY_BUTTON = (label, buttonText) => `(() => {
  const rows = [...document.querySelectorAll('li')].filter((li) => li.textContent.includes(${JSON.stringify(label)}));
  for (const row of rows) {
    const b = [...row.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(buttonText)});
    if (b) { b.click(); return true; }
  }
  return false;
})()`;

async function login(email, password) {
  await navigate("/login");
  await waitExpr(`!!document.querySelector('input[name="email"]')`, "login form");
  await evaluate(INSTALL);
  await evaluate(`__setVal('input[name="email"]', ${JSON.stringify(email)}); __setVal('input[name="password"]', ${JSON.stringify(password)}); document.querySelector("form").requestSubmit()`);
  await waitExpr(`location.pathname !== "/login"`, `post-login redirect (${email})`, 60000);
  await evaluate(INSTALL);
}

// --- run --------------------------------------------------------------------
const results = [];
const phase = (name, fn) => async () => {
  if (SKIP.has(name)) { console.log(`\n== ${name} — SKIPPED ==`); return; }
  console.log(`\n== ${name} ==`);
  await fn();
  results.push(name);
};

try {
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");
  await send("Network.clearBrowserCookies");
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

  // A. login ---------------------------------------------------------------
  await login(EMAIL, PASSWORD);
  console.log(`logged in as ${EMAIL} → ${await evaluate("location.pathname")}`);
  // Wipe leftovers from earlier runs so the queue assertions start clean.
  await evaluate(`Object.keys(localStorage).filter((k) => k.startsWith('erp-')).forEach((k) => localStorage.removeItem(k))`);

  // B. service worker ------------------------------------------------------
  await phase("sw", async () => {
    await navigate("/");
    const reg = await evaluate(`(async () => { const r = await navigator.serviceWorker.getRegistration(); return r ? r.scope : null; })()`);
    if (!reg) throw new Error("no service-worker registration — the deployed shell does not install the SW (public/sw.js)");
    console.log(`service worker registered at ${reg} ✓`);
  });

  // E. offline readiness ---------------------------------------------------
  await phase("readiness", async () => {
    await navigate("/dashboard");
    // The prep runs after login; every required kind must land in the per-user
    // cache WITHOUT visiting quotation/expense/payment pages first.
    await waitExpr(`(() => { const r = ${READINESS_CACHED}; return r !== null && r.missing.length === 0; })()`, "offline readiness prepared", 90000, 500);
    const r = await evaluate(READINESS_CACHED);
    if (!r) throw new Error("no offline-readiness cache for this user");
    console.log(`offline readiness prepared without visiting the workflow pages (${r.uid.slice(0, 8)}…) ✓`);
  });

  if (!TEST_COMPANY) {
    console.log("\n== offline-queue / offline-reload / lost-response / permanent-failure / cancel-restore — SKIPPED (UI_TEST_COMPANY not set — see runbook §2) ==");
  } else {
    // Pre-warm: every page the offline steps navigate to must already be in
    // the service worker's cache, or the offline navigation falls back to the
    // shell. Visit them online first, exactly like the runbook's Test A.
    console.log("\n(pre-warming the SW cache for the pages the offline phases navigate to)");
    await navigate("/sales/quotations");
    await navigate("/expenses");
    await navigate("/payments");

    // F + G + H + M. offline queue: quotation, expense, payment ---------------
    await phase("offline-queue", async () => {
      // Quotation — open online (already cached), go offline, fill, queue.
      await navigate("/sales/quotations");
      await waitExpr(`!!document.querySelector('button[aria-label="New quotation"]')`, "quotations page");
      await setOffline(true);
      await evaluate(`__click('button[aria-label="New quotation"]')`);
      await waitExpr(`!!document.querySelector('[role="dialog"] input[placeholder^="Pick or type a new customer"]')`, "quotation dialog");
      await sleep(1500);
      const picked = await evaluate(`__pickCompany(${JSON.stringify(TEST_COMPANY)})`);
      if (!picked) throw new Error(`test company "${TEST_COMPANY}" not offered in the quotation form — refusing to create records anywhere else`);
      await evaluate(`__setVal('[role="dialog"] input[placeholder^="Pick or type a new customer"]', 'PQC-${MARKER}')`);
      await evaluate(`__setVal('[role="dialog"] table tbody tr:first-child input[role="combobox"]', 'PQI-${MARKER}')`);
      await evaluate(`__setVal('[role="dialog"] table tbody tr:first-child input[type="number"]', '2')`);
      await evaluate(`__setVal('[role="dialog"] input[data-shortcut="d"]', '5')`);
      await sleep(500);
      // Click and read in ONE evaluate: the queue write lands synchronously,
      // and the dialog's close() then runs router.refresh() — read before that
      // so the assertion is independent of what refresh does.
      const q = await evaluate(`(() => {
        __clickText('Queue for later');
        const k = Object.keys(localStorage).find((x) => x.startsWith('erp-outbox:'));
        if (!k) return { noQueue: true };
        const es = JSON.parse(localStorage.getItem(k) || '[]');
        return { pending: es.filter((e) => e.kind === 'quotation' && e.status === 'pending').length };
      })()`);
      if (q.noQueue) throw new Error("no outbox key after queueing a quotation");
      if (q.pending !== 1) throw new Error(`expected 1 pending quotation, got ${q.pending}`);
      await waitExpr(`!document.querySelector('[role="dialog"]')`, "quotation dialog closed after queue", 20000);
      await sleep(800);
      if (offlinePosts > 0) throw new Error(`${offlinePosts} server POST(s) fired while offline (quotation)`);
      console.log("quotation queued offline, zero server requests, PENDING ✓");

      // Expense batch — navigation while offline is served by the SW cache.
      await navigate("/expenses");
      await waitExpr(`!!document.querySelector('button[aria-label="Add expenses"]')`, "expenses page (offline)");
      await evaluate(`__click('button[aria-label="Add expenses"]')`);
      await waitExpr(`!!document.querySelector('[role="dialog"] input[role="combobox"]')`, "expense dialog");
      await sleep(1500);
      const pickedE = await evaluate(`__pickCompany(${JSON.stringify(TEST_COMPANY)})`);
      if (!pickedE) throw new Error(`test company "${TEST_COMPANY}" not offered in the expense form`);
      await evaluate(`__setVal('[role="dialog"] input[role="combobox"]', 'PEC-${MARKER}')`);
      await evaluate(`__setVal('[role="dialog"] input[type="number"]', '77')`);
      await sleep(500);
      const e = await evaluate(`(() => {
        __clickText('Queue for later');
        const k = Object.keys(localStorage).find((x) => x.startsWith('erp-outbox:'));
        if (!k) return { noQueue: true };
        const es = JSON.parse(localStorage.getItem(k) || '[]');
        return { pending: es.filter((x) => x.kind === 'expense' && x.status === 'pending').length };
      })()`);
      if (e.noQueue || e.pending !== 1) throw new Error(`expected 1 pending expense, got ${e.pending}`);
      await waitExpr(`!document.querySelector('[role="dialog"]')`, "expense dialog closed after queue", 20000);
      await sleep(800);
      if (offlinePosts > 0) throw new Error(`${offlinePosts} server POST(s) fired while offline (expense)`);
      console.log("expense queued offline, zero server requests, PENDING ✓");

      // Payment batch.
      await navigate("/payments");
      await waitExpr(`!!document.querySelector('button[aria-label="Add payments"]')`, "payments page (offline)");
      await evaluate(`__click('button[aria-label="Add payments"]')`);
      await waitExpr(`!!document.querySelector('[role="dialog"] input[role="combobox"]')`, "payment dialog");
      await sleep(1500);
      const pickedP = await evaluate(`__pickCompany(${JSON.stringify(TEST_COMPANY)})`);
      if (!pickedP) throw new Error(`test company "${TEST_COMPANY}" not offered in the payment form`);
      await evaluate(`__setVal('[role="dialog"] input[role="combobox"]', 'POC-${MARKER}')`);
      await evaluate(`__setVal('[role="dialog"] input[type="number"]', '99')`);
      await sleep(500);
      const p = await evaluate(`(() => {
        __clickText('Queue for later');
        const k = Object.keys(localStorage).find((x) => x.startsWith('erp-outbox:'));
        if (!k) return { noQueue: true };
        const es = JSON.parse(localStorage.getItem(k) || '[]');
        return { pending: es.filter((x) => x.kind === 'payment' && x.status === 'pending').length };
      })()`);
      if (p.noQueue || p.pending !== 1) throw new Error(`expected 1 pending payment, got ${p.pending}`);
      await waitExpr(`!document.querySelector('[role="dialog"]')`, "payment dialog closed after queue", 20000);
      await sleep(800);
      if (offlinePosts > 0) throw new Error(`${offlinePosts} server POST(s) fired while offline (payment)`);
      console.log("payment queued offline, zero server requests, PENDING ✓");

      const s = await outboxSummary();
      if (s.entries.filter((x) => x.status === "pending").length !== 3) throw new Error("expected all three entries PENDING");
      console.log("outbox holds quotation + expense + payment, all PENDING ✓");
    });

    // C. offline reload — the SW must serve the shell and the entries survive.
    await phase("offline-reload", async () => {
      await setOffline(true);
      await send("Page.reload", { ignoreCache: false });
      await waitExpr(`document.readyState === "complete"`, "offline reload completes", 60000);
      const shell = await evaluate(`!document.querySelector('#main-frame-error') && location.protocol !== 'chrome-error:' && !!document.querySelector('header')`);
      if (!shell) throw new Error("offline reload landed on the browser's network-error page — the SW shell did not serve");
      await waitExpr(`typeof window.__click === 'function'`, "app shell interactive after offline reload", 30000);
      const s = await outboxSummary();
      if (s.entries.filter((x) => x.status === "pending").length !== 3) throw new Error("pending work lost across the offline reload");
      console.log("offline reload: app shell served by the SW, three entries still PENDING ✓");
      await setOffline(false);
    });

    // J. reconnect — the drain must send all three, exactly once.
    await phase("reconnect", async () => {
      await setOffline(false);
      await navigate("/payments");
      await waitExpr(`!document.body.innerText.includes("to sync") && !document.body.innerText.includes("Syncing") && !document.body.innerText.includes("Offline")`, "queue drained", 120000, 500);
      const s = await outboxSummary();
      if (s.entries.length > 0) throw new Error(`queue not empty after reconnect: ${JSON.stringify(s.entries)}`);
      console.log("reconnect: all three synced, queue empty, pill cleared ✓");
    });

    // K. database exactly-once (optional) ------------------------------------
    await phase("db-exactly-once", async () => {
      if (!sql) { console.log("DATABASE_URL_DIRECT not set — DB verification skipped (runbook step K)"); return; }
      const quotation = await sql`select count(*)::int as n from documents d join document_types dt on dt.id = d.document_type_id where dt.code = 'QUOTATION' and d.document_date = ${today} and d.contact_id in (select id from contacts where display_name = 'PQC-' || ${MARKER})`;
      const quoteLines = await sql`select count(*)::int as n from document_lines dl join documents d on d.id = dl.document_id where d.document_date = ${today} and d.contact_id in (select id from contacts where display_name = 'PQC-' || ${MARKER})`;
      const expenses = await sql`select count(*)::int as n from expenses e join expense_categories ec on ec.id = e.expense_category_id where e.amount = 77 and ec.name = 'PEC-' || ${MARKER}`;
      const payments = await sql`select count(*)::int as n from documents d join document_types dt on dt.id = d.document_type_id where dt.code in ('PAYMENT_MADE','PAYMENT_RECEIVED') and d.grand_total = 99 and d.contact_id in (select id from contacts where display_name = 'POC-' || ${MARKER})`;
      const checks = [
        ["quotation (exactly one)", quotation[0].n, 1],
        ["quotation lines (exactly one)", quoteLines[0].n, 1],
        ["expense (exactly one)", expenses[0].n, 1],
        ["payment (exactly one)", payments[0].n, 1],
      ];
      let ok = true;
      for (const [label, actual, want] of checks) {
        const pass = actual === want;
        ok &&= pass;
        console.log(`  ${pass ? "✓" : "✗"} ${label}: ${actual} (want ${want})`);
      }
      if (!ok) throw new Error("DB state wrong after reconnect sync");
      console.log("exactly-once verified in the database ✓");
    });

    // L. lost response on a live quotation form -------------------------------
    await phase("lost-response", async () => {
      await navigate("/sales/quotations");
      await waitExpr(`!!document.querySelector('button[aria-label="New quotation"]')`, "quotations page");
      await sleep(1500);
      await evaluate(`__click('button[aria-label="New quotation"]')`);
      await waitExpr(`!!document.querySelector('[role="dialog"] input[data-cell="0-0"]')`, "quotation dialog");
      await sleep(1500);
      await evaluate(`__pickCompany(${JSON.stringify(TEST_COMPANY)})`);
      await evaluate(`__setVal('[role="dialog"] input[placeholder^="Pick or type a new customer"]', 'PLR-${MARKER}')`);
      await evaluate(`__setVal('[role="dialog"] input[data-cell="0-0"]', 'PLI-${MARKER}')`);
      await evaluate(`__setVal('[role="dialog"] input[data-cell="0-2"]', '1')`);
      await evaluate(`__setVal('[role="dialog"] input[data-cell="0-3"]', '20')`);
      await sleep(500);
      failArmed = true;
      await evaluate(`__click('[role="dialog"] button[type="submit"]')`);
      // The server committed; the response was dropped on the wire.
      await waitExpr(`document.body.innerText.includes("Couldn't reach the server")`, "transport error after lost response", 40000);
      console.log("first save committed server-side, response lost, transport error shown ✓");
      // Replay with the SAME operation id must be refused as a duplicate.
      await evaluate(`__click('[role="dialog"] button[type="submit"]')`);
      await waitExpr(`document.body.innerText.includes("already recorded")`, "replay refused as duplicate", 40000);
      console.log("replay refused — the server recognised the committed operation ✓");
      if (sql) {
        const n = (await sql`select count(*)::int as n from documents d join document_types dt on dt.id = d.document_type_id where dt.code = 'QUOTATION' and d.contact_id in (select id from contacts where display_name = 'PLR-' || ${MARKER})`)[0].n;
        if (n !== 1) throw new Error(`lost-response quotation: expected exactly 1, found ${n}`);
        console.log("lost-response quotation: exactly one in the database ✓");
      }
      // Close the dialog.
      await evaluate(`(() => { const d = document.querySelector('[role="dialog"]'); const c = d?.querySelector('button[aria-label="Close"], button[title*="Close"]'); if (c) c.click(); return true; })()`);
    });

    // N. permanent failure → FAILED, visible, recoverable ----------------------
    await phase("permanent-failure", async () => {
      // Inject an entry the server can never accept (blank company) — a safe
      // validation failure that proves FAILED survives, is visible and is
      // reviewable, and that nothing was written.
      await evaluate(`(() => {
        const k = Object.keys(localStorage).find((x) => x.startsWith('erp-outbox:'));
        if (!k) return false;
        const es = JSON.parse(localStorage.getItem(k) || '[]');
        es.push({ id: crypto.randomUUID(), kind: 'quotation', label: 'PERM-FAIL-${MARKER}', payload: { companyId: '', contactId: '', contactName: '', documentDate: '${today}', validUntil: '', discountTotal: '0', taxTotal: '0', shippingTotal: '0', linesJson: '[]' }, createdAt: Date.now(), attempts: 0, status: 'pending' });
        localStorage.setItem(k, JSON.stringify(es));
        return true;
      })()`);
      // Navigate online: the provider mounts, reconciles and drains; the bad
      // entry must surface as FAILED with a reason, never vanish.
      await navigate("/");
      await waitExpr(`(() => {
        const k = Object.keys(localStorage).find((x) => x.startsWith('erp-outbox:'));
        if (!k) return false;
        const es = JSON.parse(localStorage.getItem(k) || '[]');
        return es.some((e) => e.label === 'PERM-FAIL-${MARKER}' && e.status === 'failed' && e.lastError);
      })()`, "entry FAILED with a reason", 60000, 400);
      const s = await outboxSummary();
      const bad = s.entries.find((e) => e.label === `PERM-FAIL-${MARKER}`);
      if (!bad) throw new Error("permanently-failed entry disappeared");
      console.log(`permanent failure: entry FAILED, visible, reason "${bad.lastError}" ✓`);
    });

    // O. cancelled archive: cancel → restore → cancel → delete forever --------
    await phase("cancel-restore", async () => {
      await evaluate(`__click('button[aria-label="Synchronisation status"]')`);
      await waitExpr(`document.body.innerText.includes("PERM-FAIL-${MARKER}")`, "tray shows the failed entry", 15000);
      // Two clicks to cancel: first arms, second confirms.
      await evaluate(TRAY_BUTTON(`PERM-FAIL-${MARKER}`, "Cancel"));
      await waitExpr(`(() => { const rows = [...document.querySelectorAll('li')].filter((li) => li.textContent.includes('PERM-FAIL-${MARKER}')); return rows.some((li) => [...li.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Yes, cancel')); })()`, "cancel armed", 10000);
      await evaluate(TRAY_BUTTON(`PERM-FAIL-${MARKER}`, "Yes, cancel"));
      await waitExpr(`(() => { const k = Object.keys(localStorage).find((x) => x.startsWith('erp-outbox-cancelled:')); if (!k) return false; const es = JSON.parse(localStorage.getItem(k) || '[]'); return es.some((e) => e.label === 'PERM-FAIL-${MARKER}'); })()`, "entry moved to the cancelled archive", 10000);
      console.log("cancel: two clicks, payload retained in the per-user archive ✓");
      // Remember the operation id from the archive — restore must reuse it.
      const archiveId = await evaluate(`(() => { const k = Object.keys(localStorage).find((x) => x.startsWith('erp-outbox-cancelled:')); if (!k) return null; const es = JSON.parse(localStorage.getItem(k) || '[]'); const e = es.find((x) => x.label === 'PERM-FAIL-${MARKER}'); return e ? e.id : null; })()`);
      // Restore: back into the live queue as a fresh pending attempt.
      await evaluate(TRAY_BUTTON(`PERM-FAIL-${MARKER}`, "Restore"));
      await waitExpr(`(() => { const k = Object.keys(localStorage).find((x) => x.startsWith('erp-outbox:')); if (!k) return false; return JSON.parse(localStorage.getItem(k) || '[]').some((e) => e.label === 'PERM-FAIL-${MARKER}' && e.status === 'pending'); })()`, "entry restored to the queue", 10000);
      const restored = (await outboxSummary()).entries.find((e) => e.label === `PERM-FAIL-${MARKER}`);
      if (restored?.id !== archiveId) throw new Error("restored entry did not keep its operation id");
      console.log("restore: back in the queue with the same operation id ✓");
      // Cancel again, then delete forever — two clicks, the only destructive path.
      await evaluate(TRAY_BUTTON(`PERM-FAIL-${MARKER}`, "Cancel"));
      await waitExpr(`(() => { const rows = [...document.querySelectorAll('li')].filter((li) => li.textContent.includes('PERM-FAIL-${MARKER}')); return rows.some((li) => [...li.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Yes, cancel')); })()`, "second cancel armed", 10000);
      await evaluate(TRAY_BUTTON(`PERM-FAIL-${MARKER}`, "Yes, cancel"));
      await waitExpr(`(() => { const k = Object.keys(localStorage).find((x) => x.startsWith('erp-outbox-cancelled:')); return k ? JSON.parse(localStorage.getItem(k) || '[]').some((e) => e.label === 'PERM-FAIL-${MARKER}') : false; })()`, "entry back in the archive", 10000);
      await evaluate(TRAY_BUTTON(`PERM-FAIL-${MARKER}`, "Delete"));
      await waitExpr(`(() => { const rows = [...document.querySelectorAll('li')].filter((li) => li.textContent.includes('PERM-FAIL-${MARKER}')); return rows.some((li) => [...li.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Delete forever')); })()`, "delete armed", 10000);
      await evaluate(TRAY_BUTTON(`PERM-FAIL-${MARKER}`, "Delete forever"));
      await waitExpr(`(() => { const k = Object.keys(localStorage).find((x) => x.startsWith('erp-outbox-cancelled:')); return k ? !JSON.parse(localStorage.getItem(k) || '[]').some((e) => e.label === 'PERM-FAIL-${MARKER}') : true; })()`, "entry deleted from the archive", 10000);
      await evaluate(`document.body.click()`); // close the tray
      console.log("delete forever: two clicks, the only destructive path ✓");
    });
  }

  // P + R. logout with pending work, User A → User B isolation ----------------
  await phase("logout-isolation", async () => {
    // Queue a pending entry while offline so the drain cannot send it.
    await navigate("/");
    await setOffline(true);
    await evaluate(`(() => {
      const k = Object.keys(localStorage).find((x) => x.startsWith('erp-outbox:'));
      if (!k) return false;
      const es = JSON.parse(localStorage.getItem(k) || '[]');
      es.push({ id: crypto.randomUUID(), kind: 'expense', label: 'LOGOUT-${MARKER}', payload: { companyId: '', expenseCategoryId: '', expenseCategoryName: 'LOGOUT-${MARKER}', settlementType: 'cash', bankAccountId: null, cashAccountId: null, chequeId: null, amount: '5', expenseDate: '${today}', notes: null }, createdAt: Date.now(), attempts: 0, status: 'pending' });
      localStorage.setItem(k, JSON.stringify(es));
      return true;
    })()`);
    await sleep(500);
    const uidA = await evaluate(`Object.keys(localStorage).map((k) => k.match(/^erp-(?:outbox|cache|draft):([^:]+)/)?.[1]).filter(Boolean)[0] ?? null`);
    if (!uidA) throw new Error("no user id to test logout persistence under");
    // Log out: with pending work the button arms first ("Log out anyway?").
    await evaluate(`__clickText('Log out')`);
    await waitExpr(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Log out anyway?')`, "logout confirm armed", 10000);
    console.log("logout with pending work: first click warns, does not log out ✓");
    await evaluate(`__clickText('Log out anyway?')`);
    await waitExpr(`location.pathname === "/login" || location.pathname === "/"`, "logged out", 30000);
    const survives = await evaluate(`(() => { const k = Object.keys(localStorage).find((x) => x.startsWith('erp-outbox:')); return k ? JSON.parse(localStorage.getItem(k) || '[]').some((e) => e.label === 'LOGOUT-${MARKER}') : false; })()`);
    if (!survives) throw new Error("pending work did not survive logout under user A's key");
    console.log(`pending work remains stored under user A (${uidA.slice(0, 8)}…) ✓`);

    if (EMAIL2 && PASSWORD2) {
      await login(EMAIL2, PASSWORD2);
      const leaks = await evaluate(`Object.keys(localStorage).filter((k) => k.startsWith('erp-')).length`);
      if (leaks > 0) throw new Error(`user B sees ${leaks} local erp- key(s) from user A — isolation broken`);
      console.log("user B: no drafts, cache, outbox or cancelled archive from user A ✓");
      await navigate("/login");
      await login(EMAIL, PASSWORD);
      const back = await evaluate(`(() => { const k = Object.keys(localStorage).find((x) => x.startsWith('erp-outbox:')); return k ? JSON.parse(localStorage.getItem(k) || '[]').some((e) => e.label === 'LOGOUT-${MARKER}') : false; })()`);
      if (!back) throw new Error("pending work lost after user A logged back in");
      console.log("user A back: the pending operation is still there ✓");
    } else {
      console.log("UI_TEST_EMAIL2/PASSWORD2 not set — user-A→B isolation skipped (runbook §6)");
    }
    // Cleanup: drop the injected test entry.
    await evaluate(`(() => { const k = Object.keys(localStorage).find((x) => x.startsWith('erp-outbox:')); if (!k) return; localStorage.setItem(k, JSON.stringify(JSON.parse(localStorage.getItem(k) || '[]').filter((e) => e.label !== 'LOGOUT-${MARKER}'))); })()`);
    await setOffline(false);
  });

  // --- report ----------------------------------------------------------------
  const out = { app: APP, marker: MARKER, company: TEST_COMPANY, phases: results, issues };
  const file = `${os.tmpdir()}/erp-production.json`;
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`\nresults written to ${file}`);
  console.log(`MARKER=${MARKER}  UI_TEST_COMPANY="${TEST_COMPANY}"`);
  console.log(issues.length === 0 ? "NO ISSUES" : `${issues.length} ISSUE(S):`);
  for (const i of issues) console.log("  " + i);
  if (sql) await sql.end();
  process.exit(issues.length === 0 ? 0 : 2);
} catch (e) {
  console.error("\nFAILED:", e.message);
  if (sql) await sql.end().catch(() => {});
  process.exit(1);
}
