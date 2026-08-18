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
  assert.ok(!source(`components/modules/${manager}`).includes("router.refresh();"), `${manager} must not add a second refresh after a revalidated Server Action`);
}

console.log("performance invariant checks passed");
