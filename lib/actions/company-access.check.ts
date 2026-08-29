import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// The server-authority boundary, pinned.
//
// The browser is untrusted, the offline cache is a preparation aid (never an
// authorization grant), and submitted ids are untrusted. Every company-scoped
// write therefore enforces BOTH halves of the boundary on the server:
//
//   A. the user currently belongs to the submitted company (membership), and
//   B. the user currently holds the operation's permission IN that company.
//
// requirePermission(session, module, action, { companyId }) does both in one
// call (lib/auth/permissions.ts); deletes, whose company is only known from the
// row, read the record scoped first and then check the permission against the
// row's own company. Settling with a cheque consumes a shared resource, so
// every link goes through the guarded UPDATE in lib/actions/cheque-link.ts,
// which refuses a cheque another document already holds.
//
// Authority must also be CURRENT, not whatever a warm server instance happened
// to cache: the in-process session Map is per instance, so a permission revoked
// on another instance (or straight in the database) must not keep authorizing
// writes here for up to the TTL. Every write action therefore reads its session
// through getLiveSession() (lib/auth/session.ts), which bypasses the Map; only
// reads keep the cached getSession(). The pins below assert both halves: the
// scoped permission call, and the live session read, inside the action body.
//
// This check pins the guards so a refactor can't silently drop the boundary.
// It is deliberately a string assertion, like server-exports.check.ts: the
// guards are one-line calls, and the day they need to move, whoever moves them
// reads this failure and updates the assertion to match the new shape.

// The body of `fn` (an "export async function …" marker) up to the next export.
// Pins are function-scoped so "the file imports getLiveSession somewhere" can't
// satisfy a guard that lives in a different action. The marker is matched with
// its opening paren so a prefix (createExpense vs createExpensesBatch) can't
// resolve to the wrong function.
function bodyOf(src: string, fn: string): string {
  const marker = `${fn}(`;
  const start = src.indexOf(marker);
  assert.notEqual(start, -1, `function marker not found: ${fn}`);
  const after = src.indexOf("\nexport ", start + marker.length);
  return src.slice(start, after === -1 ? src.length : after);
}

// [file, function marker, guard fragment]. The fragment must appear inside that
// function's body.
const REQUIRED = [
  // Queueable offline creates — permission and membership scoped to the
  // submitted company: the cache may list a company access or permission was
  // revoked from since; refuse rather than write into it.
  ["quotations.ts", "export async function createQuotation", 'requirePermission(session, "quotations", "create", { companyId: f.companyId })'],
  ["expenses.ts", "export async function createExpense", 'requirePermission(session, "expenses", "create", { companyId: values.companyId })'],
  ["expenses.ts", "export async function createExpensesBatch", 'requirePermission(session, "expenses", "create", { companyId })'],
  ["payments.ts", "export async function createPayment", 'requirePermission(session, "payments", "create", { companyId: values.companyId })'],
  ["payments.ts", "export async function createPaymentsBatch", 'requirePermission(session, "payments", "create", { companyId })'],

  // Queueable edits and deletes — permission against the submitted company
  // (edits can move the row) or the row's own company (deletes), never merely
  // somewhere in the user's permission set.
  ["quotations.ts", "export async function updateQuotation", 'requirePermission(session, "quotations", "edit", { companyId: f.companyId })'],
  ["quotations.ts", "export async function deleteQuotation", 'requirePermission(session, "quotations", "delete", { companyId: doomed.companyId })'],
  ["quotations.ts", "export async function convertQuotation", 'requirePermission(session, "quotations", "edit", { companyId: quotation.companyId })'],
  ["quotations.ts", "export async function convertQuotation", 'requirePermission(session, "sales", "create", { companyId: quotation.companyId })'],
  ["expenses.ts", "export async function updateExpense", 'requirePermission(session, "expenses", "edit", { companyId: values.companyId })'],
  ["expenses.ts", "export async function deleteExpense", 'requirePermission(session, "expenses", "delete", { companyId: existing.companyId })'],
  ["payments.ts", "export async function updatePayment", 'requirePermission(session, "payments", "edit", { companyId: existing.companyId })'],
  ["payments.ts", "export async function deletePayment", 'requireGlobalPermission(session, "payments", "delete")'],

  // Critical non-queueable creates — membership + per-company permission.
  ["sales.ts", "export async function createSale", 'requirePermission(session, "sales", "create", { companyId })'],
  ["purchases.ts", "export async function createStockPurchase", 'requirePermission(session, "purchases", "create", { companyId })'],
  ["transfers.ts", "export async function createCashTransfer", 'requirePermission(session, "accounts", "edit", { companyId })'],
  ["stock-adjustments.ts", "export async function createStockAdjustment", 'requirePermission(session, "stock_adjustments", "create", { companyId })'],
  ["returns.ts", "export async function createSalesReturn", 'requirePermission(session, "sales", "create", { companyId: source.companyId })'],
  ["stock-transfers.ts", "export async function createStockTransfer", 'requirePermission(session, "stock_transfers", "create", { companyId: header.companyId })'],
  ["ledger.ts", "export async function createOpeningBalanceEntry", 'requirePermission(session, "accounts", "create", { companyId })'],
  ["ledger.ts", "export async function setContactBalance", 'requirePermission(session, "accounts", "create", { companyId })'],
  ["ledger.ts", "export async function deleteLedgerRow", 'requirePermission(session, "accounts", "delete", { companyId: doc.companyId })'],
  ["accounts.ts", "export async function createCheque", 'requirePermission(session, "cheques", "create", { companyId: values.companyId })'],
  ["products.ts", "export async function createProductsBatch", 'requirePermission(session, "products", "create", { companyId })'],
  // Inter-company writes on both sides — each scoped to its own company.
  ["inter-company.ts", "export async function createInterCompanySale", 'requirePermission(session, "sales", "create", { companyId: sellerCompanyId })'],
  ["inter-company.ts", "export async function createInterCompanySale", 'requirePermission(session, "purchases", "create", { companyId: buyerCompanyId })'],

  // Update/delete read-before-write is scoped, and the delete permission is
  // re-checked against the row's own company.
  ["sales.ts", "export async function deleteSale", 'requirePermission(session, "sales", "delete", { companyId: existingDoc.companyId })'],
  ["sales.ts", "export async function deleteSale", "companyInScope(documents.companyId)"],
  ["purchases.ts", "export async function deleteStockPurchase", 'requireGlobalPermission(session, "purchases", "delete")'],
  ["purchases.ts", "export async function deleteStockPurchase", "companyInScope(documents.companyId)"],
  ["stock-transfers.ts", "export async function deleteStockTransfer", "companyInScope(documents.companyId)"],
  ["stock-adjustments.ts", "export async function deleteStockAdjustment", "companyInScope(documents.companyId)"],
  ["transfers.ts", "export async function deleteCashTransfer", "companyInScope(documents.companyId)"],
  ["products.ts", "export async function mergeProducts", "companyInScope(items.companyId)"],
  ["contacts.ts", "export async function updateContactsBatch", "WHERE c.id = v.id AND ${scope}"],

  // The cheque settle guard: every link is the guarded UPDATE in the shared
  // module, which refuses a cheque already attached to another document. The
  // UPDATE's row lock serialises two racers — exactly one wins.
  ["cheque-link.ts", "export async function linkCheque", "isNull(chequeRegister.documentId)"],

  // Live authority: every write action reads its session fresh, so a
  // permission revoked on another instance (or directly in the database)
  // stops authorizing writes here on the very next request — never for up to
  // the session TTL. Reads (list/get/view) keep the cached getSession().
  ["sales.ts", "export async function createSale", "await getLiveSession()"],
  ["sales.ts", "export async function updateSale", "await getLiveSession()"],
  ["sales.ts", "export async function deleteSale", "await getLiveSession()"],
  ["returns.ts", "export async function createSalesReturn", "await getLiveSession()"],
  ["returns.ts", "export async function cancelSalesReturn", "await getLiveSession()"],
  ["purchases.ts", "export async function createStockPurchase", "await getLiveSession()"],
  ["purchases.ts", "export async function updateStockPurchase", "await getLiveSession()"],
  ["purchases.ts", "export async function deleteStockPurchase", "await getLiveSession()"],
  ["purchases.ts", "export async function mergeStockPurchases", "await getLiveSession()"],
  ["purchases.ts", "export async function importStockPurchasesCsv", "await getLiveSession()"],
  ["transfers.ts", "export async function createCashTransfer", "await getLiveSession()"],
  ["transfers.ts", "export async function deleteCashTransfer", "await getLiveSession()"],
  ["stock-adjustments.ts", "export async function createStockAdjustment", "await getLiveSession()"],
  ["stock-adjustments.ts", "export async function deleteStockAdjustment", "await getLiveSession()"],
  ["stock-transfers.ts", "export async function createStockTransfer", "await getLiveSession()"],
  ["stock-transfers.ts", "export async function updateStockTransfer", "await getLiveSession()"],
  ["stock-transfers.ts", "export async function deleteStockTransfer", "await getLiveSession()"],
  ["inter-company.ts", "export async function createInterCompanySale", "await getLiveSession()"],
  ["inter-company.ts", "export async function updateInterCompanySale", "await getLiveSession()"],
  ["inter-company.ts", "export async function deleteInterCompanySale", "await getLiveSession()"],
  ["ledger.ts", "export async function createOpeningBalanceEntry", "await getLiveSession()"],
  ["ledger.ts", "export async function setContactBalance", "await getLiveSession()"],
  ["ledger.ts", "export async function deleteLedgerRow", "await getLiveSession()"],
  ["accounts.ts", "export async function updateBankAccount", "await getLiveSession()"],
  ["accounts.ts", "export async function deleteBankAccount", "await getLiveSession()"],
  ["accounts.ts", "export async function createBankAccountsBatch", "await getLiveSession()"],
  ["accounts.ts", "export async function updateCashAccount", "await getLiveSession()"],
  ["accounts.ts", "export async function deleteCashAccount", "await getLiveSession()"],
  ["accounts.ts", "export async function createCashAccountsBatch", "await getLiveSession()"],
  ["accounts.ts", "export async function createCheque", "await getLiveSession()"],
  ["accounts.ts", "export async function createChequesBatch", "await getLiveSession()"],
  ["accounts.ts", "export async function updateCheque", "await getLiveSession()"],
  ["accounts.ts", "export async function deleteCheque", "await getLiveSession()"],
  ["contacts.ts", "export async function createContactsBatch", "await getLiveSession()"],
  ["contacts.ts", "export async function updateContactsBatch", "await getLiveSession()"],
  ["contacts.ts", "export async function updateContact", "await getLiveSession()"],
  ["products.ts", "export async function createProductsBatch", "await getLiveSession()"],
  ["products.ts", "export async function updateProductsBatch", "await getLiveSession()"],
  ["products.ts", "export async function mergeProducts", "await getLiveSession()"],
  ["products.ts", "export async function importProductsCsv", "await getLiveSession()"],
  ["settings.ts", "export async function saveSettings", "await getLiveSession()"],
  ["users.ts", "export async function createUsersBatch", "await getLiveSession()"],
  ["users.ts", "export async function updateUser", "await getLiveSession()"],
  ["users.ts", "export async function addUserRole", "await getLiveSession()"],
  ["users.ts", "export async function removeUserRole", "await getLiveSession()"],
  ["users.ts", "export async function deleteUser", "await getLiveSession()"],
  ["roles.ts", "export async function createRole", "await getLiveSession()"],
  ["roles.ts", "export async function updateRole", "await getLiveSession()"],
  ["roles.ts", "export async function deleteRole", "await getLiveSession()"],
  ["companies.ts", "export async function createCompaniesBatch", "await getLiveSession()"],
  ["companies.ts", "export async function updateCompany", "await getLiveSession()"],
  ["companies.ts", "export async function deleteCompany", "await getLiveSession()"],
  ["brands.ts", "export async function createBrandsBatch", "await getLiveSession()"],
  ["brands.ts", "export async function updateBrand", "await getLiveSession()"],
  ["brands.ts", "export async function deleteBrand", "await getLiveSession()"],
  ["categories.ts", "export async function saveCategoryTree", "await getLiveSession()"],
  ["categories.ts", "export async function createCategoriesBatch", "await getLiveSession()"],
  ["categories.ts", "export async function updateCategory", "await getLiveSession()"],
  ["categories.ts", "export async function deleteCategory", "await getLiveSession()"],
  ["locations.ts", "export async function createLocationsBatch", "await getLiveSession()"],
  ["locations.ts", "export async function updateLocation", "await getLiveSession()"],
  ["locations.ts", "export async function deleteLocation", "await getLiveSession()"],
  ["units.ts", "export async function createUnitsBatch", "await getLiveSession()"],
  ["units.ts", "export async function updateUnit", "await getLiveSession()"],
  ["units.ts", "export async function deleteUnit", "await getLiveSession()"],
  ["taxes.ts", "export async function createTaxesBatch", "await getLiveSession()"],
  ["taxes.ts", "export async function updateTax", "await getLiveSession()"],
  ["taxes.ts", "export async function deleteTax", "await getLiveSession()"],
  ["unit-conversions.ts", "export async function createUnitConversion", "await getLiveSession()"],
  ["unit-conversions.ts", "export async function updateUnitConversion", "scopedRule(id, \"edit\")"],
  ["unit-conversions.ts", "export async function setUnitConversionRuleItems", "scopedRule(ruleId, \"edit\")"],
  ["unit-conversions.ts", "export async function deleteUnitConversion", "scopedRule(id, \"delete\")"],
  ["quotations.ts", "export async function createQuotation", "await getLiveSession()"],
  ["quotations.ts", "export async function updateQuotation", "await getLiveSession()"],
  ["quotations.ts", "export async function deleteQuotation", "await getLiveSession()"],
  ["quotations.ts", "export async function convertQuotation", "await getLiveSession()"],
  ["expenses.ts", "export async function createExpense", "await getLiveSession()"],
  ["expenses.ts", "export async function createExpensesBatch", "await getLiveSession()"],
  ["expenses.ts", "export async function updateExpense", "await getLiveSession()"],
  ["expenses.ts", "export async function deleteExpense", "await getLiveSession()"],
  ["payments.ts", "export async function createPayment", "await getLiveSession()"],
  ["payments.ts", "export async function createPaymentsBatch", "await getLiveSession()"],
  ["payments.ts", "export async function updatePayment", "await getLiveSession()"],
  ["payments.ts", "export async function deletePayment", "await getLiveSession()"],
  ["backups.ts", "export async function exportSnapshot", "await getLiveSession()"],
  ["backups.ts", "export async function dispatchBackupWorkflow", "await getLiveSession()"],
  ["backups.ts", "export async function dispatchBackupWorkflow", 'requireGlobalPermission(session, "backups", "create")'],
  ["reports.ts", "export async function exportReportCsv", "await getLiveSession()"],
  ["whatsapp.ts", "export async function createWhatsAppHandoff", "await getLiveSession()"],
] as const;

function main() {
  const dir = path.join(process.cwd(), "lib/actions");
  let failed = 0;
  for (const [file, fn, fragment] of REQUIRED) {
    const src = fs.readFileSync(path.join(dir, file), "utf8");
    const body = bodyOf(src, fn);
    const ok = body.includes(fragment);
    console.log(`${ok ? "ok  " : "FAIL"} ${file} ${fn} → ${fragment}`);
    if (!ok) failed++;
  }
  assert.equal(
    failed,
    0,
    `${failed} authority guard(s) missing — every company-scoped write must enforce membership + per-company permission on the server (requirePermission with { companyId }, or a scoped read-before-write for deletes), every cheque link must go through the guarded linkCheque, and every write action must read its session through getLiveSession() so a revocation on another instance stops authorizing here immediately. The browser is untrusted; the cache prepares work but never grants it.`,
  );
  console.log("\nall server authority guards in place");
}

main();
