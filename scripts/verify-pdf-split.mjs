// PDF code-splitting verification.
//
// jspdf/html2canvas are dynamically imported (lib/invoice-pdf.ts,
// lib/node-download.ts), so they must be split into chunks that only load when
// someone asks for a file. This script checks, in a real browser:
//   1. /sales/invoices (list) and /sales/invoices/<id> load WITHOUT the
//      jspdf/html2canvas chunks
//   2. /ledger loads WITHOUT them either
//   3. clicking Download PDF loads the jspdf chunk at that moment
//   4. clicking the image/PDF statement buttons loads html2canvas/jspdf
//   5. the files actually download to disk
//   6. the sizes of the loaded chunks are reported
//
// Usage: node --env-file=.env scripts/verify-pdf-split.mjs
//   (requires dev server on :3050, Chrome on :9222, UI_TEST_EMAIL/PASSWORD)
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";

const CDP = "http://127.0.0.1:9222";
const APP = "http://localhost:3050";
const EMAIL = process.env.UI_TEST_EMAIL ?? "";
const PASSWORD = process.env.UI_TEST_PASSWORD ?? "";
// Headless Chrome ignores a setDownloadBehavior path here, so downloads land in
// the browser's default Downloads folder; the downloadWillBegin event names the
// file, and it is looked up there.
const DEFAULT_DOWNLOADS = path.join(os.homedir(), "Downloads");

const sql = postgres(process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL, { max: 2 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const target = await (await fetch(`${CDP}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let id = 0;
const pending = new Map();
const scriptRequests = []; // { url, size }
const downloads = [];
const exceptions = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id) { pending.get(m.id)?.resolve(m); pending.delete(m.id); return; }
  if (m.method === "Network.requestWillBeSent" && m.params.request.url && m.params.type === "Script") {
    scriptRequests.push({ url: m.params.request.url });
  }
  if (m.method === "Network.responseReceived" && m.params.type === "Script") {
    const hit = scriptRequests.find((r) => r.url === m.params.response.url);
    if (hit) hit.size = m.params.response.encodedDataLength;
  }
  if (m.method === "Browser.downloadWillBegin") {
    downloads.push({ url: m.params.url, suggestedFilename: m.params.suggestedFilename });
  }
  if (m.method === "Browser.downloadProgress") {
    const last = downloads[downloads.length - 1];
    if (last) last.state = m.params.state;
  }
  if (m.method === "Runtime.exceptionThrown") {
    exceptions.push(`${m.params.exceptionDetails?.text} ${m.params.exceptionDetails?.exception?.description ?? ""}`.trim());
  }
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
  const diag = await evaluate(`JSON.stringify({
    path: location.pathname, ready: document.readyState,
    buttons: [...document.querySelectorAll("button")].map(b => (b.getAttribute("aria-label") ?? b.textContent.trim()).slice(0, 40)).slice(0, 20),
    text: document.body?.innerText?.slice(0, 300)?.replace(/\\s+/g, " ")
  })`).catch(() => "(evaluate failed)");
  throw new Error(`timeout (${timeout}ms) waiting for ${label} — page: ${diag}`);
};
const navigate = async (path) => {
  scriptRequests.length = 0;
  await send("Page.navigate", { url: `${APP}${path}` });
  await waitExpr(`document.readyState === "complete"`, `load ${path}`, 90000);
  await sleep(2500); // let late-loading chunks arrive
};

let failures = 0;
const check = (label, cond, detail = "") => {
  console.log(`${cond ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
};
const pdfChunks = () => scriptRequests.filter((r) => /(jspdf|html2canvas|autotable)/i.test(r.url));
const chunkLine = (chunks) => chunks.map((c) => `${path.basename(new URL(c.url).pathname)}${c.size ? ` (${(c.size / 1024).toFixed(0)}KB)` : ""}`).join(", ") || "none";

try {
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");
  await send("Network.clearBrowserCookies");
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  if (!EMAIL || !PASSWORD) throw new Error("UI_TEST_EMAIL / UI_TEST_PASSWORD env vars required");

  await navigate("/login");
  await waitExpr(`!!document.querySelector('input[name="email"]')`, "login form");
  await evaluate(`(() => {
    const setVal = (sel, v) => { const el = document.querySelector(sel); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); };
    setVal('input[name="email"]', ${JSON.stringify(EMAIL)});
    setVal('input[name="password"]', ${JSON.stringify(PASSWORD)});
    document.querySelector("form").requestSubmit();
  })()`);
  await waitExpr(`location.pathname !== "/login"`, "post-login redirect", 30000);

  const [sale] = await sql`select d.id from documents d join document_types dt on dt.id = d.document_type_id where dt.code = 'SALES_INVOICE' order by d.created_at desc limit 1`;
  if (!sale) throw new Error("no sales invoice in the database to test against");

  // --- 1. the ledger loads without them (checked first so a failed download
  // --- never contaminates the page) -------------------------------------------
  await navigate("/ledger");
  await waitExpr(`!!(document.querySelector('button[aria-label*="as PDF"]') || document.querySelector('button[aria-label*="as PNG"]'))`, "ledger page", 45000);
  check("ledger: no jspdf/html2canvas chunks on load", pdfChunks().length === 0, chunkLine(pdfChunks()));

  // --- 2. a statement download pulls the library in ----------------------------
  const hasButtons = await evaluate(`!!document.querySelector('button[aria-label*="as PDF"]') || !!document.querySelector('button[aria-label*="as PNG"]')`);
  if (hasButtons) {
    const before = new Set(fs.readdirSync(DEFAULT_DOWNLOADS));
    await evaluate(`(() => {
      const b = document.querySelector('button[aria-label*="as PDF"]') || document.querySelector('button[aria-label*="as PNG"]');
      b.click();
    })()`);
    await sleep(7000);
    const afterLedger = pdfChunks();
    check("ledger statement: the raster/pdf library loads at download time", afterLedger.length >= 1, chunkLine(afterLedger));
    const newFiles = fs.readdirSync(DEFAULT_DOWNLOADS).filter((f) => !before.has(f));
    check("ledger statement: a file actually downloaded", newFiles.length >= 1, newFiles.join(", ") || "none");
  } else {
    console.log("skip ledger statement download (no statement buttons visible)");
  }

  // --- 3. the invoice list loads without the PDF libraries --------------------
  await navigate("/sales/invoices");
  check("invoice list: no jspdf/html2canvas chunks", pdfChunks().length === 0, chunkLine(pdfChunks()));

  // --- 4. the invoice detail loads without them -------------------------------
  await navigate(`/sales/invoices/${sale.id}`);
  await waitExpr(`!![...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Download PDF")`, "invoice detail", 30000);
  check("invoice detail: no jspdf/html2canvas chunks on load", pdfChunks().length === 0, chunkLine(pdfChunks()));

  // --- 5. clicking Download PDF pulls the jspdf chunk in ----------------------
  // Chrome overwrites same-named downloads in place, so "new file" is detected
  // by mtime change rather than by name.
  const pdfBefore = new Map(fs.readdirSync(DEFAULT_DOWNLOADS).filter((f) => f.endsWith(".pdf")).map((f) => [f, fs.statSync(path.join(DEFAULT_DOWNLOADS, f)).mtimeMs]));
  await send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: DEFAULT_DOWNLOADS }).catch(() => {});
  await evaluate(`[...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Download PDF").click()`);
  await sleep(6000); // generation + download take a moment
  const afterPdf = pdfChunks();
  check("invoice PDF: jspdf chunk loads only at download time", afterPdf.length >= 1, chunkLine(afterPdf));
  const freshPdf = fs.readdirSync(DEFAULT_DOWNLOADS).filter((f) => f.endsWith(".pdf")).filter((f) => !pdfBefore.has(f) || fs.statSync(path.join(DEFAULT_DOWNLOADS, f)).mtimeMs > pdfBefore.get(f));
  check("invoice PDF: a .pdf file actually downloaded", freshPdf.length >= 1, freshPdf.join(", ") || "none");

  // --- 6. report the chunk sizes ------------------------------------------------
  console.log("\nloaded PDF-related chunks:");
  for (const c of scriptRequests.filter((r) => /(jspdf|html2canvas|autotable)/i.test(r.url))) {
    console.log(`  ${path.basename(new URL(c.url).pathname)} — ${c.size ? `${(c.size / 1024).toFixed(0)}KB` : "size unknown"}`);
  }

  console.log(`download events: ${downloads.map((d) => `${d.suggestedFilename} (${d.state})`).join(", ") || "none"}`);
  if (exceptions.length) console.log(`exceptions: ${exceptions.join(" | ")}`);

  await sql.end();
  console.log(failures === 0 ? "\nALL PDF-SPLIT CHECKS PASSED" : `\n${failures} PDF-SPLIT CHECK(S) FAILED`);
  await send("Target.closeTarget", { targetId: target.id }).catch(() => {});
  process.exit(failures === 0 ? 0 : 1);
} catch (e) {
  console.error("\nFAILED:", e.message);
  await sql.end().catch(() => {});
  await send("Target.closeTarget", { targetId: target.id }).catch(() => {});
  process.exit(1);
}
