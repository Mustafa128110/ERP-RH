import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// A correction or deletion must first lock a row that is still active.
// Otherwise two requests that both read a posted document can each change its
// financial effects. These focused pins keep that claim-before-write invariant
// visible during refactors.
function bodyOf(src: string, fn: string): string {
  const marker = `${fn}(`;
  const start = src.indexOf(marker);
  assert.notEqual(start, -1, `function marker not found: ${fn}`);
  const after = src.indexOf("\nexport ", start + marker.length);
  return src.slice(start, after === -1 ? src.length : after);
}

const REQUIRED = [
  ["sales.ts", "export async function updateSale", 'eq(documents.status, "posted")'],
  ["sales.ts", "export async function deleteSale", 'eq(documents.status, "posted")'],
  ["returns.ts", "export async function createSalesReturn", '.for("update")'],
  ["returns.ts", "export async function createSalesReturn", 'eq(documents.status, "posted")'],
  ["returns.ts", "export async function cancelSalesReturn", '.for("update")'],
  ["returns.ts", "export async function cancelSalesReturn", 'eq(documents.status, "posted")'],
  ["purchases.ts", "export async function updateStockPurchase", 'eq(documents.status, "posted")'],
  ["purchases.ts", "export async function deleteStockPurchase", 'eq(documents.status, "posted")'],
  ["payments.ts", "export async function updatePayment", 'eq(documents.status, "posted")'],
  ["payments.ts", "export async function deletePayment", 'eq(documents.status, "posted")'],
  ["stock-transfers.ts", "export async function updateStockTransfer", '.for("update")'],
  ["stock-transfers.ts", "export async function updateStockTransfer", 'eq(documents.status, "posted")'],
  ["stock-transfers.ts", "export async function deleteStockTransfer", '.for("update")'],
  ["stock-transfers.ts", "export async function deleteStockTransfer", 'eq(documents.status, "posted")'],
  ["stock-adjustments.ts", "export async function deleteStockAdjustment", '.for("update")'],
  ["stock-adjustments.ts", "export async function deleteStockAdjustment", 'inArray(documents.status, ["pending", "posted"])'],
  ["inter-company.ts", "export async function updateInterCompanySale", 'eq(documents.status, "posted")'],
  ["inter-company.ts", "export async function deleteInterCompanySale", 'eq(documents.status, "posted")'],
] as const;

function main() {
  let failed = 0;
  for (const [file, fn, fragment] of REQUIRED) {
    const src = fs.readFileSync(path.join(process.cwd(), "lib/actions", file), "utf8");
    const ok = bodyOf(src, fn).includes(fragment);
    console.log(`${ok ? "ok  " : "FAIL"} ${file} ${fn} -> ${fragment}`);
    if (!ok) failed++;
  }
  assert.equal(failed, 0, "Every critical financial edit/delete needs to claim its active document under a row lock before it changes financial effects.");

  // Purchases and payments are the two intentionally destructive lifecycles.
  // They must erase the original rows, never turn into ordinary cancellation
  // records, and company-scoped permissions must not authorize them.
  const hardDeletes = [
    {
      file: "purchases.ts",
      fn: "export async function deleteStockPurchase",
      required: [
        'requireGlobalPermission(session, "purchases", "delete")',
        "DELETE FROM inventory_transactions",
        "tx.delete(ledgerEntries)",
        "tx.delete(documents)",
        'action: "delete"',
      ],
    },
    {
      file: "payments.ts",
      fn: "export async function deletePayment",
      required: [
        'requireGlobalPermission(session, "payments", "delete")',
        "releasePaymentAllocations(tx, [paymentId])",
        "tx.delete(ledgerEntries)",
        "tx.delete(documents)",
        'action: "delete"',
      ],
    },
  ] as const;
  for (const rule of hardDeletes) {
    const src = fs.readFileSync(path.join(process.cwd(), "lib/actions", rule.file), "utf8");
    const body = bodyOf(src, rule.fn);
    for (const fragment of rule.required) {
      assert.ok(body.includes(fragment), `${rule.fn} must permanently delete with: ${fragment}`);
    }
    assert.ok(!body.includes('status: "cancelled"'), `${rule.fn} must not leave a cancelled document behind`);
  }
  console.log("\nall critical document lifecycles claim their active state first");
}

main();
