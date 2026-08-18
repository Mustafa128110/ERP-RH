import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

function contains(file: string, ...needles: string[]) {
  const source = read(file);
  for (const needle of needles) assert.ok(source.includes(needle), `${file} must contain ${needle}`);
}

// System-wide identity administration may never be authorized by a grant from
// one arbitrary company, and assigning a scoped role must provision access to
// the company that the session query uses as its boundary.
contains(
  "lib/actions/users.ts",
  'requireGlobalPermission(session, "users", "create")',
  'requireGlobalPermission(session, "users", "edit")',
  'requireGlobalPermission(session, "users", "delete")',
  "userCompanyAccess",
  "canGrantRole",
);

// Universal documents share one table. Every endpoint that opens or mutates a
// subtype must bind the id to that subtype, not merely to documents.id.
for (const [file, code] of [
  ["lib/actions/sales.ts", "SALES_INVOICE"],
  ["lib/actions/purchases.ts", "PURCHASE_INVOICE"],
  ["lib/actions/stock-transfers.ts", "STOCK_TRANSFER"],
  ["lib/actions/stock-adjustments.ts", "STOCK_ADJUSTMENT"],
  ["lib/actions/quotations.ts", "QUOTATION"],
] as const) {
  contains(file, `eq(documentTypes.code, "${code}")`, "companyInScope(documents.companyId)");
}
contains("lib/actions/payments.ts", 'inArray(documentTypes.code, ["PAYMENT_MADE", "PAYMENT_RECEIVED"])');

// Money movement validates ownership in the transaction and concurrent edits
// lock their old state before reversing it.
contains(
  "lib/actions/settlement.ts",
  "b.company_id = i.company_id",
  "c.company_id = i.company_id",
  "q.company_id = i.company_id",
  "adjustSettlementBalancesBatch",
  "SettlementScopeError",
);
for (const file of ["lib/actions/sales.ts", "lib/actions/purchases.ts", "lib/actions/payments.ts", "lib/actions/expenses.ts"]) {
  contains(file, '.for("update")');
}

// Private pages and RSC payloads must never enter a persistent browser cache.
const worker = read("public/sw.js");
assert.ok(worker.includes('url.pathname.startsWith("/_next/static/")'));
assert.ok(!worker.includes('request.mode === "navigate"'), "service worker must not intercept navigations");
assert.ok(!worker.includes('cache.put(request, copy)') || worker.includes("if (!isPublicStatic) return"));
assert.ok(!worker.includes('const CACHE = "erp-v1"'), "the old private-page cache generation must be retired");

// Every browser CSV export uses the shared formula-injection escaping.
for (const file of ["components/modules/SnapshotExport.tsx", "components/modules/ReportView.tsx"]) {
  contains(file, 'import { toCsv } from "@/lib/csv"');
  assert.ok(!read(file).includes("const cell ="), `${file} must not reimplement CSV escaping`);
}

const pkg = JSON.parse(read("package.json")) as { dependencies: Record<string, string> };
assert.equal(pkg.dependencies.next, "^16.3.1");

console.log("security-invariants checks passed");
