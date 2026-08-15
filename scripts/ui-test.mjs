// UI smoke test for the popup add flows at a narrow (phone) viewport.
// Drives headless Chrome over the DevTools Protocol using Node's built-in
// WebSocket + fetch. Checks:
//   - the "+" button opens the dialog
//   - the dialog fits the viewport (no horizontal overflow of the box)
//   - the dialog has a form with fields and reachable buttons
//   - Escape closes it again
//   - no console errors / failed requests along the way
// Screenshots land in /tmp/erp-ui-shots/<page>.png.

import os from "node:os";

const CDP = "http://127.0.0.1:9222";
const APP = "http://localhost:3050";
const EMAIL = process.env.UI_TEST_EMAIL ?? "";
const PASSWORD = process.env.UI_TEST_PASSWORD ?? "";
const SHOTS = `${os.tmpdir()}/erp-ui-shots`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- CDP plumbing -----------------------------------------------------------
const target = await (await fetch(`${CDP}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = rej;
});

let id = 0;
const pending = new Map();
const errors = [];
const events = [];

ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id) {
    pending.get(msg.id)?.resolve(msg);
    pending.delete(msg.id);
    return;
  }
  events.push(msg);
  if (msg.method === "Runtime.exceptionThrown") {
    errors.push(`EXCEPTION: ${msg.params.exceptionDetails?.text} ${msg.params.exceptionDetails?.exception?.description ?? ""}`.trim());
  }
  if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
    errors.push(`CONSOLE: ${msg.params.args.map((a) => a.value ?? a.description ?? "").join(" ")}`);
  }
  if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") {
    errors.push(`LOG: ${msg.params.entry.text}`);
  }
  if (msg.method === "Network.loadingFailed" && msg.params.canceled !== true && msg.params.type !== "Image") {
    errors.push(`LOAD FAIL: ${msg.params.errorText}`);
  }
};

const send = (method, params = {}) =>
  new Promise((resolve, rej) => {
    const mid = ++id;
    pending.set(mid, { resolve, rej });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

// --- helpers ----------------------------------------------------------------
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
  await waitExpr(`document.readyState === "complete"`, `load ${path}`, 90000);
}

async function setInput(selector, value) {
  await evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
}

async function screenshot(name) {
  const r = await send("Page.captureScreenshot", { format: "png" });
  const { writeFileSync } = await import("node:fs");
  writeFileSync(`${SHOTS}/${name}.png`, Buffer.from(r.result.data, "base64"));
  return `${SHOTS}/${name}.png`;
}

// The checks that matter on a phone: the dialog box itself must fit the
// viewport width, and its content must be reachable (fields present, at least
// one visible button, a form to submit).
const DIALOG_CHECKS = `(() => {
  const d = document.querySelector('[role="dialog"]');
  if (!d) return { open: false };
  const r = d.getBoundingClientRect();
  const buttons = [...d.querySelectorAll("button")].filter((b) => b.offsetParent !== null);
  const fields = d.querySelectorAll("input,select,textarea").length;
  return {
    open: true,
    fits: r.right <= innerWidth + 1 && r.width <= innerWidth + 1,
    rect: { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), width: Math.round(r.width), height: Math.round(r.height) },
    innerWidth,
    fields,
    visibleButtons: buttons.length,
    hasForm: !!d.querySelector("form"),
    saveText: buttons.map((b) => b.textContent.trim()).filter(Boolean).slice(0, 4),
  };
})()`;

async function testPopup(path, openButtonLabel, name) {
  console.log(`\n=== ${name} (${path}) ===`);
  const t0 = Date.now();
  await navigate(path);
  await waitExpr(`!!document.querySelector('button[aria-label=${JSON.stringify(openButtonLabel)}]')`, `${name} + button`);
  await evaluate(`document.querySelector('button[aria-label=${JSON.stringify(openButtonLabel)}]').click()`);
  await waitExpr(`!!document.querySelector('[role="dialog"]')`, `${name} dialog`, 30000);

  const check = await evaluate(DIALOG_CHECKS);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`open: ${check.open}  fits: ${check.fits}  fields: ${check.fields}  buttons: ${check.visibleButtons}  form: ${check.hasForm}  (${elapsed}s)`);
  console.log(`rect: ${JSON.stringify(check.rect)}  innerWidth: ${check.innerWidth}`);
  if (check.saveText?.length) console.log(`buttons: ${check.saveText.join(" | ")}`);

  const shot = await screenshot(name.replace(/\s+/g, "-").toLowerCase());
  console.log(`screenshot: ${shot}`);

  if (!check.open || !check.fits || !check.hasForm || check.fields === 0 || check.visibleButtons === 0) {
    throw new Error(`${name} FAILED mobile checks: ${JSON.stringify(check)}`);
  }

  // Escape should peel the dialog away.
  await evaluate(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))`);
  await waitExpr(`!document.querySelector('[role="dialog"]')`, `${name} dialog closes on Escape`, 10000);
  console.log("Escape closes: ok");
}

async function testPageLoad(path, name) {
  console.log(`\n=== ${name} (${path}) — load check ===`);
  await navigate(path);
  await waitExpr(`document.querySelector("main") !== null || document.body.innerText.length > 0`, `${name} render`);
  const overflow = await evaluate(`document.documentElement.scrollWidth - innerWidth`);
  console.log(`page horizontal overflow: ${overflow}px`);
  if (overflow > 1) throw new Error(`${name} has horizontal page overflow of ${overflow}px`);
  const shot = await screenshot(name.replace(/\s+/g, "-").toLowerCase());
  console.log(`screenshot: ${shot}`);
}

// --- run --------------------------------------------------------------------
try {
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Log.enable");
  await send("Network.enable");
  // A previous run may have left a session cookie; start logged out.
  await send("Network.clearBrowserCookies");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });

  if (!EMAIL || !PASSWORD) throw new Error("UI_TEST_EMAIL / UI_TEST_PASSWORD env vars required");

  // Log in through the real form so the session cookie is exactly what the app
  // would have.
  await navigate("/login");
  await waitExpr(`!!document.querySelector('input[name="email"]')`, "login form");
  await setInput('input[name="email"]', EMAIL);
  await setInput('input[name="password"]', PASSWORD);
  await evaluate(`document.querySelector("form").requestSubmit()`);
  await waitExpr(`location.pathname !== "/login"`, "post-login redirect", 30000);
  console.log(`logged in as ${EMAIL} → ${await evaluate("location.pathname")}`);

  // The four converted popup flows.
  await testPopup("/inventory/stock-transfers", "New transfer", "Stock Transfers");
  await testPopup("/inventory/stock-adjustments", "New adjustment", "Stock Adjustments");
  await testPopup("/inventory/inter-company", "New inter-company sale", "Inter-Company");
  await testPopup("/sales/quotations", "New quotation", "Quotations");

  // The pages whose search boxes I removed — confirm they still render cleanly
  // and don't overflow at 390px.
  await testPageLoad("/payments", "Payments");
  await testPageLoad("/sales/invoices", "Invoices");
  await testPageLoad("/audit-logs", "Audit Logs");
  await testPageLoad("/inventory/stock-movements", "Stock Movements");

  console.log("\n" + "=".repeat(60));
  console.log(errors.length === 0 ? "NO CONSOLE / NETWORK ERRORS" : `${errors.length} ERROR(S):`);
  for (const e of errors) console.log("  " + e);
  process.exit(errors.length === 0 ? 0 : 2);
} catch (e) {
  console.error("\nFAILED:", e.message);
  process.exit(1);
}
