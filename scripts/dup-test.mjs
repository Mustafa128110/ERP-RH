// Duplicate-submission failure-condition test for the operation-id protection.
//
// Reproduces the exact scenario the protection exists for:
//   1. user clicks Save; the request reaches the server and COMMITS
//   2. the response is lost on the wire (simulated: the first Next-Action POST
//      is fulfilled with an HTTP 500 after the server has already committed)
//   3. the user clicks Save again with the same operation id
//   4. the server must refuse the replay — exactly ONE record must exist
//
// Drives headless Chrome over CDP (same plumbing as scripts/ui-test.mjs).
// Requires UI_TEST_EMAIL / UI_TEST_PASSWORD (a throwaway admin) and the dev
// server on :3050 with Chrome on :9222.
import os from "node:os";

const CDP = "http://127.0.0.1:9222";
const APP = "http://localhost:3050";
const EMAIL = process.env.UI_TEST_EMAIL ?? "";
const PASSWORD = process.env.UI_TEST_PASSWORD ?? "";
const MARKER = `dup-test-${Date.now()}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const target = await (await fetch(`${CDP}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = rej;
});

let id = 0;
const pending = new Map();
const errors = [];

ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id) {
    pending.get(msg.id)?.resolve(msg);
    pending.delete(msg.id);
    return;
  }
  if (msg.method === "Runtime.exceptionThrown") {
    errors.push(`EXCEPTION: ${msg.params.exceptionDetails?.text} ${msg.params.exceptionDetails?.exception?.description ?? ""}`.trim());
  }
  if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
    errors.push(`CONSOLE: ${msg.params.args.map((a) => a.value ?? a.description ?? "").join(" ")}`);
  }
  if (msg.method === "Fetch.requestPaused") handlePaused(msg.params);
};

const send = (method, params = {}) =>
  new Promise((resolve, rej) => {
    const mid = ++id;
    pending.set(mid, { resolve, rej });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

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
  const ok = await evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  if (!ok) throw new Error(`input not found: ${selector}`);
}

// --- response-lost simulation -------------------------------------------------
// The FIRST Next-Action POST goes through to the server (it commits) but its
// response is replaced with a 500, so the client believes it failed. Every
// later request is passed through untouched.
let nextActionPosts = 0;

function handlePaused(params) {
  const req = params.request;
  const headers = Array.isArray(req?.headers) ? req.headers : Object.entries(req?.headers ?? {}).map(([name, value]) => ({ name, value }));
  const isNextAction = req?.method === "POST" && headers.some((h) => String(h.name).toLowerCase() === "next-action");
  // Some Chrome builds tag the pause with requestStage; this one signals the
  // stage by whether the response fields are populated yet.
  const stage = params.requestStage ?? (params.responseStatusCode !== undefined ? "Response" : "Request");
  if (req?.method === "POST") console.log(`[${stage}] ${req.method} ${req.url} nextAction=${isNextAction}`);
  if (stage === "Request") {
    if (isNextAction) nextActionPosts++;
    void send("Fetch.continueRequest", { requestId: params.requestId });
    return;
  }
  if (isNextAction && nextActionPosts === 1) {
    // Response stage of the first save: the server already committed; the
    // client gets a 500 instead of the success payload.
    void send("Fetch.fulfillRequest", {
      requestId: params.requestId,
      responseCode: 500,
      responsePhrase: "Internal Server Error",
      body: "",
    });
    return;
  }
  void send("Fetch.continueResponse", { requestId: params.requestId });
}

// --- run --------------------------------------------------------------------
try {
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");
  await send("Network.clearBrowserCookies");
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

  if (!EMAIL || !PASSWORD) throw new Error("UI_TEST_EMAIL / UI_TEST_PASSWORD env vars required");

  await navigate("/login");
  await waitExpr(`!!document.querySelector('input[name="email"]')`, "login form");
  await setInput('input[name="email"]', EMAIL);
  await setInput('input[name="password"]', PASSWORD);
  await evaluate(`document.querySelector("form").requestSubmit()`);
  await waitExpr(`location.pathname !== "/login"`, "post-login redirect", 30000);
  console.log(`logged in as ${EMAIL} → ${await evaluate("location.pathname")}`);

  // Open the expense batch dialog.
  await navigate("/expenses");
  await waitExpr(`!!document.querySelector('button[aria-label="Add expenses"]')`, "Add expenses button");
  await evaluate(`document.querySelector('button[aria-label="Add expenses"]').click()`);
  await waitExpr(`!!document.querySelector('[role="dialog"]')`, "expense dialog", 30000);
  console.log("expense batch dialog open");

  // Fill one row: a typed category (created on save), an amount, and a unique
  // note that lets the cleanup script find exactly this expense.
  await setInput('[role="dialog"] input[role="combobox"]', `Dup Test ${MARKER}`);
  await setInput('[role="dialog"] input[type="number"]', "12.5");
  await setInput('[role="dialog"] input:not([type]):not([role="combobox"])', MARKER);

  // Arm the interception, then click Save. The server commits; the client sees 500.
  await send("Fetch.enable", {
    patterns: [
      { urlPattern: "*", requestStage: "Request" },
      { urlPattern: "*", requestStage: "Response" },
    ],
  });
  await evaluate(`document.querySelector('[role="dialog"] [data-dialog-submit]').click()`);
  await sleep(3000);
  console.log(
    "after click:",
    await evaluate(`(() => { const d = document.querySelector('[role="dialog"]'); return { dialogOpen: !!d, text: d ? d.innerText.slice(0, 200) : "(no dialog)" }; })()`),
  );

  // The transport error must surface inline — the dialog must NOT be stuck on
  // "Saving…" with the save disabled.
  await waitExpr(
    `document.body.innerText.includes("Couldn't reach the server")`,
    "transport error message after first (lost) save",
    30000,
  );
  const afterFirst = await evaluate(`(() => {
    const d = document.querySelector('[role="dialog"]');
    const save = d?.querySelector("[data-dialog-submit]");
    return {
      open: !!d,
      saveDisabled: save?.disabled,
      saveText: save?.textContent.trim(),
      error: [...d.querySelectorAll("p")].map((p) => p.textContent).find((t) => t.includes("reach the server")) ?? null,
    };
  })()`);
  console.log("after first save (server committed, response lost):", JSON.stringify(afterFirst));
  if (!afterFirst.open || afterFirst.saveDisabled) throw new Error("dialog stuck after lost response — Save must stay enabled");
  if (!afterFirst.error) throw new Error("lost-response failure must be visible, not silent");

  // The user clicks Save again — same operation id, so the server must refuse.
  await evaluate(`document.querySelector('[role="dialog"] [data-dialog-submit]').click()`);
  await waitExpr(`document.body.innerText.includes("already recorded")`, "duplicate refusal message", 30000);

  const afterSecond = await evaluate(`(() => {
    const d = document.querySelector('[role="dialog"]');
    return {
      open: !!d,
      saveDisabled: d?.querySelector("[data-dialog-submit]")?.disabled,
      message: [...d.querySelectorAll("p")].map((p) => p.textContent).find((t) => t.includes("already recorded")) ?? null,
    };
  })()`);
  console.log("after second save (replay):", JSON.stringify(afterSecond));
  if (!afterSecond.open || !afterSecond.message) throw new Error("replay must be refused with the duplicate message");
  if (afterSecond.saveDisabled) throw new Error("save must stay enabled after a refused replay");

  console.log(`\nMARKER=${MARKER}`);
  console.log(errors.length === 0 ? "NO CONSOLE / NETWORK ERRORS" : `${errors.length} ERROR(S):`);
  for (const e of errors) console.log("  " + e);
  process.exit(errors.length === 0 ? 0 : 2);
} catch (e) {
  console.error("\nFAILED:", e.message);
  process.exit(1);
}
