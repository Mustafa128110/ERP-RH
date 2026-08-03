// What the "Record stock & rate" half of the product edit grid will accept.
//
// Lives outside lib/actions/products.ts because that file is "use server" and
// may only export async functions — same reason lib/sale-constants.ts and
// lib/adjustment-constants.ts exist. Pure, so it can be checked without a
// database (lib/product-edit-rules.check.ts).
//
// The rule that matters: a quantity is optional. "This is what it costs now" is
// a complete statement on its own — a price list arrives with no goods attached
// — so a rate alone records the rate and moves no stock. A quantity means goods
// actually turned up, and goods came from someone and landed somewhere.

export interface PurchaseRowFields {
  purchaseQty: string;
  purchaseRate: string;
  supplierId: string;
  supplierName: string;
}

const num = (s: string) => Number(s.trim() || "0");

/** Goods arrived: stock moves, so a supplier and a location are needed. */
export const recordsQty = (row: PurchaseRowFields) => num(row.purchaseQty) > 0;

/** A price was stated, with or without goods. */
export const recordsRate = (row: PurchaseRowFields) => Number(row.purchaseRate) > 0;

/** The row says nothing at all and is skipped entirely. */
export const isBlankPurchaseRow = (row: PurchaseRowFields) =>
  !recordsQty(row) && row.purchaseRate.trim() === "" && !row.supplierId && row.supplierName.trim() === "";

/** Whether this row causes a document to be written. */
export const writesDocument = (row: PurchaseRowFields) => recordsQty(row) || recordsRate(row);

/**
 * The row's own validation error, or null. `label` names the row in the message
 * the way the user sees it ("Row 3 (Hinge 4in)").
 */
export function purchaseRowError(row: PurchaseRowFields, label: string): string | null {
  const qty = num(row.purchaseQty);
  if (!Number.isFinite(qty) || qty < 0) return `${label}: quantity must be zero or more.`;
  if (isBlankPurchaseRow(row)) return null;
  // A supplier or a quantity without a price says goods moved for an unknown
  // amount, which is the one combination that can't be filed.
  if (!recordsRate(row)) return `${label}: enter the purchase rate.`;
  if (recordsQty(row) && !row.supplierId && !row.supplierName.trim()) {
    return `${label}: name a supplier for the goods received.`;
  }
  return null;
}
