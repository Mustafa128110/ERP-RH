// Offline-first verification for the PENDING outbox (Stage 3) + user-scoped
// drafts (Stage 1a) + the sync indicator.
//
// Scenarios, all driven through a real browser with network emulation:
//   1. OFFLINE ENQUEUE: with the network offline, fill a quotation, an expense
//      batch and a payment batch, and click "Queue for later" on each. The
//      queue must hold three PENDING entries; no server action may fire; the
//      forms close as if saved (the work now lives in the queue).
//   2. RECONNECT: emulate the network back. The drain must fire and sync all
//      three — each exactly once, verified against the database (one quotation,
//      one expense, one payment; related records exact).
//   3. DRAFT ISOLATION: user A types a draft, logs out; user B (a second
//      throwaway admin) logs in on the same browser and must NOT be offered
//      user A's draft. The draft key is scoped per user.
//
// Dev-mode note: the dev server has no service worker, so *navigating* while
// offline shows Chrome's offline page (production serves the SW shell). The
// offline moment is therefore emulated around each queue click on an already
// loaded page — which is exactly the production experience: the page is open,
// the network drops, work continues.
//
// Usage: node --env-file=.env scripts/verify-offline.mjs
//   (dev server on :3050, Chrome on :9222, UI_TEST_EMAIL/PASSWORD, and
//   UI_TEST_EMAIL2/PASSWORD2 for the second user)
import os from "node:os";
import fs from "node:fs";
import postgres from "postgres";

const CDP = "http://127.0.0.1:9222";
const APP = "http://localhost:3050";
const EMAIL = process.env.UI_TEST_EMAIL ?? "";
const PASSWORD = process.env.UI_TEST_PASSWORD ?? "";
const EMAIL2 = process.env.UI_TEST_EMAIL2 ?? "";
const PASSWORD2 = process.env.UI_TEST_PASSWORD2 ?? "";
const MARKER = `off${Date.now()}`;
const today = new Date().toLocaleDateString("en-CA");

const sql = postgres(process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL, { max: 2 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const target = await (await fetch(`${CDP}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let id = 0;
const pending = new Map();
const issues = [];
// Server-action POSTs observed while offline — there must be none.
let offlinePosts = 0;
let offline = false;

ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id) { pending.get(msg.id)?.resolve(msg); pending.delete(msg.id); return; }
  if (msg.method === "Runtime.exceptionThrown") {
    issues.push(`EXCEPTION: ${msg.params.exceptionDetails?.text} ${msg.params.exceptionDetails?.exception?.description ?? ""}`.trim());
  }
  // Only real server-action POSTs count — dev-mode telemetry endpoints
  // (__nextjs_original-stack-frames) also POST and would be false positives.
  if (
    msg.method === "Network.requestWillBeSent" &&
    msg.params.request?.method === "POST" &&
    offline &&
    msg.params.request.headers?.["Next-Action"]
  ) {
    offlinePosts += 1;
    console.log(`[OFFLINE POST] ${msg.params.request.url} body=${String(msg.params.request.postData ?? "").slice(0, 120)}`);
  }
  // Load failures while OFFLINE are expected in dev: the dialog's close() runs
  // router.refresh(), which with no service worker hard-navigates to Chrome's
  // error page. Production serves the SW shell, so this is dev-only. Only
  // failures while online are real.
  if (!offline && msg.method === "Network.loadingFailed" && msg.params.canceled !== true && msg.params.type !== "Image" && msg.params.type !== "Fetch") {
    issues.push(`LOAD FAIL: ${msg.params.errorText}`);
  }
};

const send = (method, params = {}) =>
  new Promise((resolve, rej) => { const mid = ++id; pending.set(mid, { resolve, rej }); ws.send(JSON.stringify({ id: mid, method, params })); });

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
  // The window helpers must survive navigation; reinstall after load and wait
  // for them to be usable (hydration may lag readyState).
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
  await sleep(1500); // let the online/offline event settle in the provider
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

// --- login --------------------------------------------------------------
async function login(email, password) {
  await navigate("/login");
  await waitExpr(`!!document.querySelector('input[name="email"]')`, "login form");
  await evaluate(INSTALL);
  await evaluate(`__setVal('input[name="email"]', ${JSON.stringify(email)}); __setVal('input[name="password"]', ${JSON.stringify(password)}); document.querySelector("form").requestSubmit()`);
  await waitExpr(`location.pathname !== "/login"`, `post-login redirect (${email})`, 30000);
  await evaluate(INSTALL);
}

try {
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");
  await send("Network.clearBrowserCookies");
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

  if (!EMAIL || !PASSWORD || !EMAIL2 || !PASSWORD2) {
    throw new Error("UI_TEST_EMAIL/PASSWORD and UI_TEST_EMAIL2/PASSWORD2 env vars required");
  }

  // === Phase 1: OFFLINE ENQUEUE =============================================
  await login(EMAIL, PASSWORD);
  console.log(`logged in as ${EMAIL} → ${await evaluate("location.pathname")}`);
  // Wipe leftovers from earlier runs — the isolation checks must not trip on a
  // draft a previous script wrote under the pre-scoping bare key.
  await evaluate(`Object.keys(localStorage).filter((k) => k.startsWith('erp-')).forEach((k) => localStorage.removeItem(k))`);

  // Quotation — navigate and open the dialog online, then go offline to fill
  // and queue.
  await navigate("/sales/quotations");
  await waitExpr(`!!document.querySelector('button[aria-label="New quotation"]')`, "quotations page");
  await evaluate(`__click('button[aria-label="New quotation"]')`);
  await waitExpr(`!!document.querySelector('[role="dialog"] input[placeholder^="Pick or type a new customer"]')`, "quotation dialog");

  await setOffline(true);
  offlinePosts = 0;
  await evaluate(`__setVal('[role="dialog"] input[placeholder^="Pick or type a new customer"]', 'OC-${MARKER}')`);
  await evaluate(`__setVal('[role="dialog"] table tbody tr:first-child input[role="combobox"]', 'OI-${MARKER}')`);
  await evaluate(`__setVal('[role="dialog"] table tbody tr:first-child input[type="number"]', '2')`);
  await evaluate(`__setVal('[role="dialog"] input[data-shortcut="d"]', '5')`);
  await sleep(800);
  // Click and read in ONE evaluate: the queue write lands synchronously, but
  // the dialog's close() then runs router.refresh() — which in dev (no service
  // worker) hard-navigates to chrome-error while offline. Reading after the
  // navigation would read the error page, not the app.
  const q = await evaluate(`(() => {
    __clickText('Queue for later');
    const k = Object.keys(localStorage).find((x) => x.startsWith('erp-outbox:'));
    if (!k) return { noQueue: true };
    const es = JSON.parse(localStorage.getItem(k) || '[]');
    return { pending: es.filter((e) => e.kind === 'quotation' && e.status === 'pending').length };
  })()`);
  if (q.noQueue) throw new Error("no erp-outbox: key after queueing a quotation");
  if (q.pending !== 1) throw new Error(`expected 1 pending quotation in the queue, got ${q.pending}`);
  // The dialog closes (onDone → close) — the page may or may not already have
  // navigated to chrome-error by now; either way the dialog is gone.
  await waitExpr(`!document.querySelector('[role="dialog"]')`, "quotation dialog closed after queue", 15000);
  await sleep(800);
  if (offlinePosts > 0) throw new Error(`${offlinePosts} server POST(s) fired while offline (quotation)`);
  console.log("quotation queued offline, zero server requests, entry PENDING ✓");

  // === Phase 2: RECONNECT (per operation) ===================================
  // Back online: re-navigate to the page (the old one may be on chrome-error
  // after the offline refresh). A fresh provider mount reconciles orphaned
  // entries and drains the queue — exactly the crash-recovery path.
  await setOffline(false);
  await navigate("/sales/quotations");
  await waitExpr(`!document.body.innerText.includes("to sync") && !document.body.innerText.includes("Syncing") && !document.body.innerText.includes("Offline")`, "quotation drained", 60000, 400);
  console.log("reconnect: quotation synced, pill cleared ✓");

  // Expense batch.
  await navigate("/expenses");
  await waitExpr(`!!document.querySelector('button[aria-label="Add expenses"]')`, "expenses page");
  await evaluate(`__click('button[aria-label="Add expenses"]')`);
  await waitExpr(`!!document.querySelector('[role="dialog"] input[role="combobox"]')`, "expense dialog");

  await setOffline(true);
  offlinePosts = 0;
  await evaluate(`__setVal('[role="dialog"] input[role="combobox"]', 'OC-${MARKER}')`);
  await evaluate(`__setVal('[role="dialog"] input[type="number"]', '77')`);
  await sleep(800);
  const e = await evaluate(`(() => {
    __clickText('Queue for later');
    const k = Object.keys(localStorage).find((x) => x.startsWith('erp-outbox:'));
    if (!k) return { noQueue: true };
    const es = JSON.parse(localStorage.getItem(k) || '[]');
    return { pending: es.filter((x) => x.kind === 'expense' && x.status === 'pending').length };
  })()`);
  if (e.noQueue) throw new Error("no erp-outbox: key after queueing an expense");
  if (e.pending !== 1) throw new Error(`expected 1 pending expense in the queue, got ${e.pending}`);
  await waitExpr(`!document.querySelector('[role="dialog"]')`, "expense dialog closed after queue", 15000);
  await sleep(800);
  if (offlinePosts > 0) throw new Error(`${offlinePosts} server POST(s) fired while offline (expense)`);
  console.log("expense queued offline, zero server requests, entry PENDING ✓");

  await setOffline(false);
  await navigate("/expenses");
  await waitExpr(`!document.body.innerText.includes("to sync") && !document.body.innerText.includes("Syncing") && !document.body.innerText.includes("Offline")`, "expense drained", 60000, 400);
  console.log("reconnect: expense synced, pill cleared ✓");

  // Payment batch.
  await navigate("/payments");
  await waitExpr(`!!document.querySelector('button[aria-label="Add payments"]')`, "payments page");
  await evaluate(`__click('button[aria-label="Add payments"]')`);
  await waitExpr(`!!document.querySelector('[role="dialog"] input[role="combobox"]')`, "payment dialog");

  await setOffline(true);
  offlinePosts = 0;
  await evaluate(`__setVal('[role="dialog"] input[role="combobox"]', 'OC-${MARKER}')`);
  await evaluate(`__setVal('[role="dialog"] input[type="number"]', '99')`);
  await sleep(800);
  const p = await evaluate(`(() => {
    __clickText('Queue for later');
    const k = Object.keys(localStorage).find((x) => x.startsWith('erp-outbox:'));
    if (!k) return { noQueue: true };
    const es = JSON.parse(localStorage.getItem(k) || '[]');
    return { pending: es.filter((x) => x.kind === 'payment' && x.status === 'pending').length };
  })()`);
  if (p.noQueue) throw new Error("no erp-outbox: key after queueing a payment");
  if (p.pending !== 1) throw new Error(`expected 1 pending payment in the queue, got ${p.pending}`);
  await waitExpr(`!document.querySelector('[role="dialog"]')`, "payment dialog closed after queue", 15000);
  await sleep(800);
  if (offlinePosts > 0) throw new Error(`${offlinePosts} server POST(s) fired while offline (payment)`);
  console.log("payment queued offline, zero server requests, entry PENDING ✓");

  await setOffline(false);
  await navigate("/payments");
  await waitExpr(`!document.body.innerText.includes("to sync") && !document.body.innerText.includes("Syncing") && !document.body.innerText.includes("Offline")`, "payment drained", 60000, 400);
  console.log("reconnect: payment synced, pill cleared ✓");

  // === Phase 3: DATABASE STATE ==============================================
  // Each of the three operations must exist exactly once, with dependent
  // records exact. Marker-based: the quotation/expense/payment were created
  // with typed names/items carrying the marker.
  // All four checks are scoped through the OC-<marker> contact the forms typed,
  // so rows left by earlier runs (same amount/date) cannot pollute the count.
  const quotation = await sql`select count(*)::int as n from documents d join document_types dt on dt.id = d.document_type_id where dt.code = 'QUOTATION' and d.document_date = ${today} and d.contact_id in (select id from contacts where display_name = 'OC-' || ${MARKER})`;
  const quoteLines = await sql`select count(*)::int as n from document_lines dl join documents d on d.id = dl.document_id where d.document_date = ${today} and d.contact_id in (select id from contacts where display_name = 'OC-' || ${MARKER})`;
  // The expense dialog's combobox is the category — the typed OC-<marker> text
  // became a new expense category, which is where the marker lives.
  const expenses = await sql`select count(*)::int as n from expenses e join expense_categories ec on ec.id = e.expense_category_id where e.amount = 77 and ec.name = 'OC-' || ${MARKER}`;
  const payments = await sql`select count(*)::int as n from documents d join document_types dt on dt.id = d.document_type_id where dt.code in ('PAYMENT_MADE','PAYMENT_RECEIVED') and d.grand_total = 99 and d.contact_id in (select id from contacts where display_name = 'OC-' || ${MARKER})`;

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

  // === Phase 4: DRAFT ISOLATION =============================================
  // User A types a sale draft, logs out. User B logs in on the same browser
  // and must not be offered it — the draft key is sale:<uidA>.
  await navigate("/sales");
  await waitExpr(`!!document.querySelector('input[data-cell="0-0"]')`, "sale page");
  await evaluate(`__setVal('input[data-cell="0-0"]', 'ISO-${MARKER}')`);
  await evaluate(`__setVal('input[data-cell="0-2"]', '5')`);
  await sleep(1200); // draft effect writes
  // The draft must live under a user-scoped key (erp-draft:sale:<uid>), never
  // the bare erp-draft:sale a shared browser would leak between users.
  const scoped = await evaluate(`Object.keys(localStorage).some((k) => k.startsWith('erp-draft:sale:') && localStorage.getItem(k).includes('ISO-${MARKER}'))`);
  const bare = await evaluate(`!!localStorage.getItem('erp-draft:sale')`);
  if (!scoped) throw new Error("draft not found under a user-scoped key");
  if (bare) throw new Error("draft written under the unscoped key — isolation broken");
  console.log("draft written under sale:<uid>, not bare sale ✓");

  // Log out.
  await evaluate(`__clickText('Log out')`);
  await waitExpr(`location.pathname === "/login" || location.pathname === "/"`, "logged out", 30000);

  // User B logs in.
  await login(EMAIL2, PASSWORD2);
  await navigate("/sales");
  await waitExpr(`!!document.querySelector('input[data-cell="0-0"]')`, "sale page (user B)");
  await sleep(1500);
  const offered = await evaluate(`document.body.innerText.includes("unsaved sale from earlier")`);
  if (offered) throw new Error("User B was offered User A's draft — draft keys are not user-isolated");
  console.log("draft isolation: user B not offered user A's draft ✓");

  const out = { marker: MARKER, checks, issues };
  fs.writeFileSync(`${os.tmpdir()}/erp-offline.json`, JSON.stringify(out, null, 2));
  console.log("\nresults written to " + `${os.tmpdir()}/erp-offline.json`);
  console.log(issues.length === 0 ? "NO ISSUES" : `${issues.length} ISSUE(S):`);
  for (const i of issues) console.log("  " + i);
  process.exit(issues.length === 0 ? 0 : 2);
} catch (e) {
  console.error("\nFAILED:", e.message);
  process.exit(1);
}
