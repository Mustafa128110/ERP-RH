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

// Rendered pages and RSC payloads ARE cached now — the app has to stay readable
// on a dropping shop link, and a full page load offline can get its HTML from
// nowhere else. That was an explicit decision, so the invariant is no longer
// "never cache private HTML"; it is that private HTML cannot outlive the session
// that fetched it, and cannot be served in place of a live answer.
const worker = read("public/sw.js");
assert.ok(worker.includes('url.pathname.startsWith("/_next/static/")'));
// Two caches, and the split is the safety argument: the page cache has to be
// droppable on sign-out without discarding the build assets, which are not
// private at all and would otherwise be re-downloaded on every logout.
assert.ok(worker.includes('const SHELL_CACHE = "erp-shell-v1"'), "private pages need their own cache generation");
assert.ok(worker.includes('const STATIC_CACHE = "erp-static-v2"'), "public build output must not share the private cache");
assert.ok(worker.includes("KEEP.includes(key)"), "activate must keep both caches — otherwise it wipes the page cache on every deploy");
// Cleared on sign-out (Topbar's postMessage) AND on anything landing on /login,
// which is where both logout and an expired session go. The second path is what
// makes it reliable: the postMessage is racing a navigation away from the page,
// and on a machine the whole shop shares a missed clear leaves one person's
// books readable by the next.
assert.ok(worker.includes("isLoginPath"), "the worker must recognise the no-session route");
assert.equal(
  worker.split("caches.delete(SHELL_CACHE)").length - 1,
  2,
  "the page cache must be dropped from both the sign-out message and the /login path",
);
// Never pin "you are not signed in" over a real route: a redirected or non-ok
// response is not storable, which covers requireSession() sending an expired
// session to /login and the unfollowed opaqueredirect browsers hand back for
// some navigations.
assert.ok(worker.includes("if (!response.ok || response.redirected) return false;"), "redirects must not be cached");
// Network-first for pages, never cache-first. A cached page answers a request
// that could not be made; it must never answer one that could.
assert.ok(worker.includes("function networkFirst"), "pages must go through the network-first path");
assert.ok(worker.includes("networkFirst(request, isRsc ? rscKey(request, url) : request)"), "pages and RSC payloads must both use it");
assert.ok(!worker.includes('const CACHE = "erp-v1"'), "the old private-page cache generation must be retired");

// Every browser CSV export uses the shared formula-injection escaping.
for (const file of ["components/modules/SnapshotExport.tsx", "components/modules/ReportView.tsx"]) {
  contains(file, 'import { toCsv } from "@/lib/csv"');
  assert.ok(!read(file).includes("const cell ="), `${file} must not reimplement CSV escaping`);
}

const pkg = JSON.parse(read("package.json")) as { dependencies: Record<string, string> };
assert.equal(pkg.dependencies.next, "^16.3.1");

console.log("security-invariants checks passed");
