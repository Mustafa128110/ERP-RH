// Case B: the server transaction FAILS, rolls back (operation-id claim
// included), and the retry with the SAME operation id succeeds.
//
// The cheque batch is the natural place to inject a real server-side failure:
// its unique (bank_account_id, cheque_number) constraint fires inside the
// transaction, after the operation-id claim. Steps:
//   1. open the cheque batch dialog, pick a bank account
//   2. pre-insert a blocker cheque with the SAME number and bank account —
//      the first Save will claim the operation id, fail the batch insert, and
//      roll everything back (claim included)
//   3. Save -> the dialog shows the duplicate error, nothing written
//   4. delete the blocker
//   5. Save again with the same operation id -> the claim is free again (it
//      rolled back with the failed transaction) so the retry SUCCEEDS
//   6. the database holds exactly one cheque
//
// Usage: node --env-file=.env scripts/verify-rollback.mjs
//   (requires dev server on :3050, Chrome on :9222, UI_TEST_EMAIL/PASSWORD)
import postgres from "postgres";

const CDP = "http://127.0.0.1:9222";
const APP = "http://localhost:3050";
const EMAIL = process.env.UI_TEST_EMAIL ?? "";
const PASSWORD = process.env.UI_TEST_PASSWORD ?? "";
const MARKER = `TC-rollback-${Date.now()}`;
const today = new Date().toLocaleDateString("en-CA");

const sql = postgres(process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL, { max: 2 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const target = await (await fetch(`${CDP}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let id = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id) { pending.get(msg.id)?.resolve(msg); pending.delete(msg.id); }
};
const send = (method, params = {}) => new Promise((resolve, rej) => { const mid = ++id; pending.set(mid, { resolve, rej }); ws.send(JSON.stringify({ id: mid, method, params })); });
const evaluate = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(`eval failed: ${r.result.exceptionDetails.text}`);
  return r.result?.result?.value;
};
const waitExpr = async (expr, label, timeout = 60000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (await evaluate(expr)) return; await sleep(250); }
  throw new Error(`timeout waiting for ${label}`);
};
const navigate = async (path) => {
  await send("Page.navigate", { url: `${APP}${path}` });
  await waitExpr(`document.readyState === "complete"`, `load ${path}`, 90000);
};
const setVal = (selector, value) => evaluate(`(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return false;
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
})()`);
const pickNth = (selector, n) => evaluate(`(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return false;
  const options = [...el.options].filter((o) => o.value && !o.disabled);
  const o = options[${n}];
  if (!o) return false;
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(el, o.value);
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
})()`);

try {
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");
  await send("Network.clearBrowserCookies");
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  if (!EMAIL || !PASSWORD) throw new Error("UI_TEST_EMAIL / UI_TEST_PASSWORD env vars required");

  // --- log in ---------------------------------------------------------------
  await navigate("/login");
  await waitExpr(`!!document.querySelector('input[name="email"]')`, "login form");
  await setVal('input[name="email"]', EMAIL);
  await setVal('input[name="password"]', PASSWORD);
  await evaluate(`document.querySelector("form").requestSubmit()`);
  await waitExpr(`location.pathname !== "/login"`, "post-login redirect", 30000);

  // --- open the cheque batch dialog ------------------------------------------
  await navigate("/accounts");
  await waitExpr(`!!document.querySelector('button[title*="Alt+N"]')`, "accounts add button");
  await evaluate(`[...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Cheques").click()`);
  await sleep(500);
  await evaluate(`document.querySelector('button[title*="Alt+N"]').click()`);
  await waitExpr(`!!document.querySelector('[role="dialog"] input[type="number"]')`, "cheque batch dialog");
  await sleep(1000);

  // --- pick a real bank account so the unique constraint can fire -------------
  // Each row cell holds its own select, so the bank account is the select in
  // the row's second td (Company is the first).
  const bankSelect = '[role="dialog"] table tbody tr:first-child td:nth-of-type(2) select';
  const picked = await pickNth(bankSelect, 0);
  if (!picked) throw new Error("no bank account option in the cheque dialog — add one first");
  const ctx = await evaluate(`(() => {
    const tr = document.querySelector('[role="dialog"] table tbody tr:first-child');
    const company = tr.querySelector('td:nth-of-type(1) select').value;
    const bank = tr.querySelector('td:nth-of-type(2) select').value;
    return { company, bank };
  })()`);
  console.log(`bank account picked: ${ctx.bank.slice(0, 8)} (company ${ctx.company.slice(0, 8)})`);

  // --- blocker: same number + same bank account, already registered -----------
  await sql`
    insert into cheque_register (company_id, bank_account_id, cheque_number, cheque_date, amount, cheque_type, status, issued_by_company)
    values (${ctx.company}, ${ctx.bank}, ${MARKER}, ${today}, 99, 'ACCOUNT_PAYEE', 'IN_HAND', false)
  `;
  console.log("blocker cheque inserted (same number + bank account)");

  // --- fill the row and Save: must fail server-side and roll back -------------
  await setVal('[role="dialog"] table tbody tr:first-child input:not([type]):not([role="combobox"])', MARKER);
  await setVal('[role="dialog"] table tbody tr:first-child input[type="date"]', today);
  await setVal('[role="dialog"] input[type="number"]', "15");
  await sleep(300);
  await evaluate(`document.querySelector('[role="dialog"] [data-dialog-submit]').click()`);
  await waitExpr(`document.body.innerText.includes("duplicated for its bank account")`, "server-side duplicate rejection", 30000);
  console.log("first save refused by the database — transaction (and claim) rolled back");

  const afterFail = await evaluate(`(() => {
    const d = document.querySelector('[role="dialog"]');
    return { open: !!d, saveDisabled: d?.querySelector("[data-dialog-submit]")?.disabled, error: [...d.querySelectorAll("p")].map((p) => p.textContent).find((t) => t.includes("duplicated")) ?? null };
  })()`);
  if (!afterFail.open || afterFail.saveDisabled || !afterFail.error) throw new Error(`dialog must stay open with the error and Save enabled: ${JSON.stringify(afterFail)}`);

  // Nothing may have been written by the failed attempt.
  const afterFailed = await sql`select count(*)::int as n from cheque_register where cheque_number = ${MARKER}`;
  if (afterFailed[0].n !== 1) throw new Error(`failed attempt must leave only the blocker, found ${afterFailed[0].n}`);
  console.log("failed attempt wrote nothing (only the blocker remains)");

  // --- remove the blocker, retry with the SAME operation id -------------------
  await sql`delete from cheque_register where cheque_number = ${MARKER}`;
  console.log("blocker removed");
  await evaluate(`document.querySelector('[role="dialog"] [data-dialog-submit]').click()`);
  await waitExpr(`!document.querySelector('[role="dialog"]')`, "retry succeeds and dialog closes", 30000);
  console.log("retry with the same operation id succeeded");

  // --- exactly one cheque in the database --------------------------------------
  const rows = await sql`select cheque_number, amount, bank_account_id from cheque_register where cheque_number = ${MARKER}`;
  console.log(`cheques with ${MARKER}: ${rows.length}`);
  if (rows.length !== 1) throw new Error(`expected exactly 1 cheque, found ${rows.length}`);
  if (Number(rows[0].amount) !== 15) throw new Error(`expected amount 15, found ${rows[0].amount}`);
  console.log("PASS: one cheque, amount 15, retry of a rolled-back failure went through");
  await sql.end();
  process.exit(0);
} catch (e) {
  console.error("\nFAILED:", e.message);
  await sql`delete from cheque_register where cheque_number = ${MARKER}`.catch(() => {});
  await sql.end().catch(() => {});
  process.exit(1);
}
