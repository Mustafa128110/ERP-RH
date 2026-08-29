// A persisted item/unit pair is the narrow exception that lets an old purchase
// be corrected after explicit unit-conversion rules were introduced. The same
// key is built from the stored lines and from the submitted edit; changing to a
// different disconnected pair therefore remains invalid.
export function purchaseLineKey(itemId: string | null | undefined, unitId: string | null | undefined): string {
  return JSON.stringify([itemId ?? null, unitId ?? null]);
}

export function legacyPurchasePairKeys(
  lines: readonly { itemId: string | null; unitId: string | null }[],
): ReadonlySet<string> {
  return new Set(lines.map((line) => purchaseLineKey(line.itemId, line.unitId)));
}

// Older paid purchases predate mandatory settlement selection. Their paid flag
// is real history, but no bank/cash/cheque balance was changed, so an edit or
// cancellation has nothing to reverse. Treat only an actually recorded target
// as reversible; otherwise the settlement batch receives a "missing" target and
// rejects every unrelated edit with SettlementScopeError.
export function hasRecordedPurchaseSettlement(value: {
  bankAccountId: string | null;
  cashAccountId: string | null;
  chequeId: string | null;
}): boolean {
  return Boolean(value.bankAccountId || value.cashAccountId || value.chequeId);
}

export type PurchasePaidMode = "yes" | "partial" | "no";

const money = (value: number) => Number(value.toFixed(2));

// documents.paid_amount is an aggregate: freight paid as an expense, money paid
// at the purchase counter, and later PAYMENT_MADE allocations. Only the middle
// part belongs to the purchase's own settlement account and may be reversed by
// editing the purchase.
export function purchaseSettlementAmount(
  paidAmount: number,
  shippingExpenseAmount: number,
  allocatedPaymentAmount: number,
): number {
  return money(Math.max(0, paidAmount - shippingExpenseAmount - allocatedPaymentAmount));
}

export function purchasePaidMode(settlementAmount: number, goodsTotal: number): PurchasePaidMode {
  if (settlementAmount <= 0) return "no";
  return settlementAmount >= goodsTotal ? "yes" : "partial";
}

export function requestedPurchaseSettlement(mode: PurchasePaidMode, enteredAmount: number, goodsTotal: number): number {
  if (mode === "no") return 0;
  if (mode === "yes") return money(Math.max(0, goodsTotal));
  return money(Math.max(0, Math.min(enteredAmount, goodsTotal)));
}

export function remainingPurchasePayable(grandTotal: number, shippingAmount: number, settlementAmount: number): number {
  return money(Math.max(0, grandTotal - shippingAmount - settlementAmount));
}
