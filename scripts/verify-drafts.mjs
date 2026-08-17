// Draft-persistence verification for the M2 forms: stock transfers, stock
// adjustments, quotations.
//
// For each form:
//   1. type into it → a draft lands in localStorage (erp-draft:<key>)
//   2. reload the page → the draft is still there
//   3. reopen the form → it is OFFERED (banner), never applied on its own
//   4. Restore → the fields come back
//   5. a reload restores a FRESH operation id (new mount = new id, so a
//      restored draft can never reuse a stale claim)
//   6. submitting the restored draft succeeds and CLEARS the draft
//
// Also asserts nothing is submitted on its own after a reload (the draft is a
// draft, not a queue).
//
// Usage: node --env-file=.env scripts/verify-drafts.mjs
//   (requires dev server on :3050, Chrome on :9222, UI_TEST_EMAIL/PASSWORD)
import postgres from "postgres";

const CDP = "http://127.0.0.1:9222";
const APP = "http://localhost:3050";
const EMAIL = process.env.UI_TEST_EMAIL ?? "";
const PASSWORD = process.env.UI_TEST_PASSWORD ?? "";
const MARKER = `v${Date.now()}`;

const sql = postgres(process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL, { max: 2 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const target = await (await fetch(`${CDP}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let id = 0;
const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id) { pending.get(m.id)?.resolve(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((resolve, rej) => { const mid = ++id; pending.set(mid, { resolve, rej }); ws.send(JSON.stringify({ id: mid, method, params })); });
const evaluate = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(`eval failed: ${r.result.exceptionDetails.text} — ${expression.slice(0, 120)}`);
  return r.result?.result?.value;
};
const waitExpr = async (expr, label, timeout = 60000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (await evaluate(expr)) return; await sleep(250); }
  throw new Error(`timeout (${timeout}ms) waiting for ${label}`);
};
const navigate = async (path) => {
  await send("Page.navigate", { url: `${APP}${path}` });
  await waitExpr(`document.readyState === "complete"`, `load ${path}`, 90000);
};

const INSTALL = `(() => {
  if (window.__dReady) return;
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
  window.__dReady = true;
})()`;

// One row of checks per form. `open`/`fill`/`fillReady` are browser
// expressions; `draftKey` is the localStorage key; `submitSel` finds the Save
// button; `verifyDoc` checks the database after a successful submit.
const forms = {
  transfer: {
    path: "/inventory/stock-transfers",
    open: `document.querySelector('button[aria-label="New transfer"]').click()`,
    openReady: `!!document.querySelector('[role="dialog"] input[data-cell="0-0"]')`,
    fill: (m) => `
      __pickNth('[role="dialog"] select[name="fromLocationId"]', 0);
      __pickNth('[role="dialog"] select[name="toLocationId"]', 0);
      __setVal('[role="dialog"] input[data-cell="0-0"]', 'TI-draft-${m}');
      __setVal('[role="dialog"] input[data-cell="0-2"]', '3');`,
    draftKey: "transfer",
    noun: "transfer",
    submitSel: '[role="dialog"] button[type="submit"]',
    restoredCheck: `(() => {
      const cell = document.querySelector('[role="dialog"] input[data-cell="0-0"]');
      const qty = document.querySelector('[role="dialog"] input[data-cell="0-2"]');
      return cell && qty && cell.value.includes("TI-draft-") && qty.value === "3";
    })()`,
    verifyDoc: async (itemName) => {
      // count(distinct) because a transfer writes two lines per item.
      const n = (await sql`select count(distinct d.id)::int as n from documents d join document_lines dl on dl.document_id = d.id join items i on i.id = dl.item_id where i.name = ${itemName}`)[0].n;
      return n === 1;
    },
  },
  adjustment: {
    path: "/inventory/stock-adjustments",
    open: `document.querySelector('button[aria-label="New adjustment"]').click()`,
    openReady: `!!document.querySelector('[role="dialog"] input[data-cell="0-0"]')`,
    fill: (m) => `
      __pickNth('[role="dialog"] select[name="locationId"]', 0);
      __pickNth('[role="dialog"] select[name="reason"]', 0);
      __setVal('[role="dialog"] input[data-cell="0-0"]', 'TI-draft-${m}');
      __setVal('[role="dialog"] input[data-cell="0-2"]', '-1');`,
    draftKey: "adjustment",
    noun: "stock adjustment",
    submitSel: '[role="dialog"] button[type="submit"]',
    restoredCheck: `(() => {
      const cell = document.querySelector('[role="dialog"] input[data-cell="0-0"]');
      const qty = document.querySelector('[role="dialog"] input[data-cell="0-2"]');
      return cell && qty && cell.value.includes("TI-draft-") && qty.value === "-1";
    })()`,
    verifyDoc: async (itemName) => {
      // count(distinct) because a transfer writes two lines per item.
      const n = (await sql`select count(distinct d.id)::int as n from documents d join document_lines dl on dl.document_id = d.id join items i on i.id = dl.item_id where i.name = ${itemName}`)[0].n;
      return n === 1;
    },
  },
  quotation: {
    path: "/sales/quotations",
    open: `document.querySelector('button[aria-label="New quotation"]').click()`,
    openReady: `!!document.querySelector('[role="dialog"] input[data-cell="0-0"]')`,
    fill: (m) => `
      __setVal('[role="dialog"] input[placeholder^="Pick or type a new customer"]', 'TQ-draft-${m}');
      __setVal('[role="dialog"] input[data-cell="0-0"]', 'TI-draft-${m}');
      __setVal('[role="dialog"] input[data-cell="0-2"]', '1');
      __setVal('[role="dialog"] input[data-cell="0-3"]', '20');`,
    draftKey: "quotation",
    noun: "quotation",
    submitSel: '[role="dialog"] button[type="submit"]',
    restoredCheck: `(() => {
      const cell = document.querySelector('[role="dialog"] input[data-cell="0-0"]');
      const qty = document.querySelector('[role="dialog"] input[data-cell="0-2"]');
      return cell && qty && cell.value.includes("TI-draft-") && qty.value === "1";
    })()`,
    verifyDoc: async (itemName) => {
      // count(distinct) because a transfer writes two lines per item.
      const n = (await sql`select count(distinct d.id)::int as n from documents d join document_lines dl on dl.document_id = d.id join items i on i.id = dl.item_id where i.name = ${itemName}`)[0].n;
      return n === 1;
    },
  },
};

let failures = 0;
const check = (label, cond, detail = "") => {
  console.log(`${cond ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
};

try {
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");
  await send("Network.clearBrowserCookies");
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  if (!EMAIL || !PASSWORD) throw new Error("UI_TEST_EMAIL / UI_TEST_PASSWORD env vars required");

  await navigate("/login");
  await waitExpr(`!!document.querySelector('input[name="email"]')`, "login form");
  await evaluate(INSTALL);
  await evaluate(`__setVal('input[name="email"]', ${JSON.stringify(EMAIL)}); __setVal('input[name="password"]', ${JSON.stringify(PASSWORD)}); document.querySelector("form").requestSubmit()`);
  await waitExpr(`location.pathname !== "/login"`, "post-login redirect", 30000);

  for (const [name, form] of Object.entries(forms)) {
    const itemName = `TI-draft-${name}-${MARKER}`;
    const contactName = `TQ-draft-${name}-${MARKER}`;
    console.log(`\n=== draft: ${name} ===`);

    // --- 1. type into the form → a draft lands in localStorage ---------------
    await navigate(form.path);
    await sleep(1500);
    await evaluate(INSTALL);
    await evaluate(form.open);
    await waitExpr(form.openReady, `${name} dialog open`, 60000);
    await sleep(1500);
    // A per-form marker keeps the three typed item names distinct, so each
    // form's document is found by its own item.
    await evaluate(form.fill(`${name}-${MARKER}`));
    await sleep(1200); // the save-on-change effect writes the draft
    const draftWritten = await evaluate(`!!localStorage.getItem(${JSON.stringify(`erp-draft:${form.draftKey}`)})`);
    check(`${name}: draft written to localStorage while typing`, draftWritten === true);
    const draftBefore = await evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(`erp-draft:${form.draftKey}`)}) || 'null')`);
    check(`${name}: draft holds the typed item`, draftBefore?.value?.lines?.some?.((l) => String(l.itemText).includes("TI-draft-")) === true, "");

    // --- 2. reload → the draft survives ---------------------------------------
    await navigate(form.path);
    await sleep(1500);
    const draftAfterReload = await evaluate(`!!localStorage.getItem(${JSON.stringify(`erp-draft:${form.draftKey}`)})`);
    check(`${name}: draft survives a page reload`, draftAfterReload === true);

    // --- 3. reopen → OFFERED, not applied --------------------------------------
    await evaluate(form.open);
    await waitExpr(form.openReady, `${name} dialog reopen`, 60000);
    await sleep(1500);
    const banner = await evaluate(`document.body.innerText.includes(${JSON.stringify(`unsaved ${form.noun} from earlier`)})`);
    check(`${name}: the draft is offered (banner), never applied on its own`, banner === true);
    const appliedSilently = await evaluate(form.restoredCheck);
    check(`${name}: form is NOT pre-filled before Restore`, appliedSilently === false);
    const beforeRestore = await evaluate(`!!document.querySelector('[role="dialog"] input[name="operationId"]')`);
    check(`${name}: form carries an operation id`, beforeRestore === true);

    // --- 4. nothing was submitted on its own ------------------------------------
    await sleep(1500);
    const itemDocCount = (await sql`select count(*)::int as n from items where name = ${itemName}`)[0].n;
    check(`${name}: no document was auto-submitted by the reload`, itemDocCount === 0, `items found: ${itemDocCount}`);

    // --- 5. Restore → the fields come back --------------------------------------
    await evaluate(`[...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent.trim() === "Restore it").click()`);
    await waitExpr(form.restoredCheck, `${name} restored`, 15000);
    check(`${name}: Restore repopulates the form`, true);

    // --- 6. a reload mints a FRESH operation id ----------------------------------
    const opId1 = await evaluate(`document.querySelector('[role="dialog"] input[name="operationId"]').value`);
    await navigate(form.path);
    await sleep(1500);
    await evaluate(form.open);
    await waitExpr(form.openReady, `${name} dialog reopen 2`, 60000);
    await sleep(1500);
    await evaluate(`[...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent.trim() === "Restore it").click()`);
    await waitExpr(form.restoredCheck, `${name} restored again`, 15000);
    const opId2 = await evaluate(`document.querySelector('[role="dialog"] input[name="operationId"]').value`);
    check(`${name}: a restored draft submits under a FRESH operation id`, !!opId1 && !!opId2 && opId1 !== opId2, `${opId1.slice(0, 8)} vs ${opId2.slice(0, 8)}`);

    // --- 7. submit the restored draft → succeeds and clears the draft ------------
    await evaluate(`document.querySelector(${JSON.stringify(form.submitSel)}).click()`);
    // The dialog closes on success (popup forms).
    await waitExpr(`!document.querySelector('[role="dialog"]')`, `${name} saved`, 40000);
    const draftCleared = await evaluate(`!localStorage.getItem(${JSON.stringify(`erp-draft:${form.draftKey}`)})`);
    check(`${name}: draft cleared after a successful save`, draftCleared === true);
    const docOk = await form.verifyDoc(itemName);
    check(`${name}: exactly one document in the database`, docOk === true);
  }

  await sql.end();
  console.log(failures === 0 ? "\nALL DRAFT CHECKS PASSED" : `\n${failures} DRAFT CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
} catch (e) {
  console.error("\nFAILED:", e.message);
  await sql.end().catch(() => {});
  process.exit(1);
}
