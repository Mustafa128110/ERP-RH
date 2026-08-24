import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const source = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const requires = (file: string, fragments: string[]) => {
  const body = source(file);
  for (const fragment of fragments) assert.ok(body.includes(fragment), `${file} must retain ${fragment}`);
};

// These are architecture checks rather than microbenchmarks: the remote
// database makes statement count the dominant batch latency, so the important
// regression is a future edit putting an awaited per-row resolver/update back.
requires("lib/actions/payments.ts", ["nextDocumentNumberRange", "resolveContactIds", "adjustSettlementBalancesBatch", "prepared.map"]);
requires("lib/actions/expenses.ts", ["resolveExpenseCategoryIds", "adjustSettlementBalancesBatch"]);
requires("lib/actions/sales.ts", ["resolveItemIds", "resolveUnitIds"]);
requires("lib/actions/purchases.ts", ["resolveItemIds", "resolveUnitIds"]);
requires("lib/actions/stock-transfers.ts", ["resolveItemIds", "resolveUnitIds", "averageCosts"]);
requires("lib/actions/stock-adjustments.ts", ["resolveItemIds", "resolveUnitIds", "averageCosts"]);
requires("lib/actions/inter-company.ts", ["mirrorItemsToBuyer", "resolveItemIds", "resolveUnitIds"]);
requires("lib/actions/products.ts", ["groupBy(documentLines.itemId, documentLines.unitId)", "Promise.all([...groups.values()]", "onHandByItemUnit"]);
requires("lib/queries/lookups.ts", ["scopedLookup(CACHE.items, items.companyId, queryItemOptions)"]);
requires("components/layout/Sidebar.tsx", ["function IntentLink", "onPointerEnter", "onFocus", "onTouchStart"]);

const managers = [
  "RecordManager.tsx",
  "AccountsManager.tsx",
  "ExpenseManager.tsx",
  "PaymentManager.tsx",
  "InvoiceManager.tsx",
  "ProductsManager.tsx",
  "StockPurchaseManager.tsx",
];
for (const manager of managers) {
  const body = source(`components/modules/${manager}`);
  assert.ok(!body.includes("router.refresh();"), `${manager} must not add a second refresh after a revalidated Server Action`);
  // Every list applies its own writes. Rendering straight off the server prop
  // means a save doesn't move the screen until a full route re-render comes back
  // from a database ~170ms away, which is the wait this replaced.
  assert.ok(body.includes("useOptimisticRecords("), `${manager} must show its own writes — call useOptimisticRecords on the records it renders`);
}

// The three parts that make an optimistic write survivable. Each is one prop, and
// dropping any one of them fails quietly — the screen still works, it just loses
// what someone typed or shows a row as settled while it is still in the air.
requires("components/ui/DataTable.tsx", [
  // A row in flight has to look different from one the server has confirmed.
  "pendingIds",
  "data-pending",
  // Warming on hover is what makes opening a row instant; keyboard focus is
  // deliberately not a trigger, since arrowing down a list would fetch every row.
  "onRowIntent",
  "onPointerEnter",
  "onTouchStart",
]);
// `tr[data-pending]` is the whole of the fade — without it `pendingIds` is inert.
requires("app/globals.css", ["tr[data-pending]"]);
// A dialog that unmounts while its write is in the air throws away everything
// typed into it, which is the one thing this must never do: it hides instead, and
// comes back with the error still on it when the action settles.
requires("components/ui/Dialog.tsx", ["hidden?: boolean"]);

// A warm copy taken before a save is stale, so every screen that pre-fetches a
// row's detail must also drop that copy when the row is written.
for (const manager of ["InvoiceManager.tsx", "PaymentManager.tsx", "StockPurchaseManager.tsx", "ExpenseManager.tsx"]) {
  requires(`components/modules/${manager}`, ["forgetWarm"]);
}

// --- Offline ----------------------------------------------------------------
// experimental.useOffline is what stops a Server Action rejecting when the
// network is gone: Next holds it and re-runs it on reconnect, so every form in
// the app gets zero-data-loss retry rather than only the three the outbox can
// queue. It is safe purely because every create claims a client-minted
// operationId inside its transaction — a re-run of a call that committed is
// refused as a duplicate.
requires("next.config.ts", ["useOffline: true"]);

// Both halves of the connectivity signal. navigator.onLine is accurate on a cold
// hydration where no event ever fires; useOffline() is what catches WiFi with a
// dead upstream. Dropping either one makes the pill and the banner lie in one of
// those two situations.
requires("components/layout/SyncProvider.tsx", [
  'from "next/offline"',
  "getOnlineSnapshot",
  "browserOnline && !detectedOffline",
  // The drain is not a form: a submit Next is holding pending for a returning
  // network would hold `syncing` and wedge every later drain behind it, with no
  // backoff and no FAILED surfacing. Abandoning the attempt is safe — the entry
  // keeps its operation id, so the loser of the race is refused as a duplicate.
  "SUBMIT_DEADLINE_MS",
  "withDeadline(sendEntry(entry))",
]);

// One sentence explaining why a Save button is sitting still, in the place the
// user is already looking. Reads the provider's value so it cannot disagree with
// the Topbar pill.
requires("components/layout/OfflineNotice.tsx", ["useSync()", "if (online) return null;"]);
requires("app/(dashboard)/layout.tsx", ["<OfflineNotice />"]);
// The segment shell useOffline needs, and the one place that can say why a
// prefetched route is still waiting. Reads next/offline rather than the provider
// on purpose: a Suspense fallback that throws on a missing context takes the
// loading screen down with it.
requires("app/(dashboard)/loading.tsx", ['"use client"', 'from "next/offline"', "const offline = useOffline();"]);

// The duplicate-post window useOffline opens, closed. An offline Save no longer
// fails, so it is still in flight when the user reaches for "Queue for later" —
// and the queue mints its own operation id, so the same work would post twice
// under two ids the duplicate guard cannot connect. Exactly one in-flight copy.
requires("components/ui/BatchAddDialog.tsx", ["const offline = useOffline();", "disabled={pending}"]);
requires("components/modules/QuotationForm.tsx", ["disabled={pending || locked || filled.length === 0}"]);

// The one case useOffline explicitly cannot cover: a full page load needs HTML
// from somewhere, and offline there is nowhere but here. Prefetches are excluded
// deliberately — hover-prefetching makes them outnumber real navigations several
// times over and their payloads are partials, so caching them would evict the
// pages someone actually opened out of a bounded cache. (What may be *stored* is
// asserted in lib/security-invariants.check.ts; this is about what stays warm.)
requires("public/sw.js", [
  'const SHELL_CACHE = "erp-shell-v1"',
  'request.mode !== "navigate"',
  'request.headers.get("next-router-prefetch")',
  "SHELL_LIMIT",
]);

console.log("performance invariant checks passed");
