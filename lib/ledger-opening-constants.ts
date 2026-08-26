export type OpeningBalanceDirection = "owes_us" | "we_owe";

export function isOpeningBalanceDirection(value: string): value is OpeningBalanceDirection {
  return value === "owes_us" || value === "we_owe";
}

// Party statements run debit minus credit: positive means the party owes us and
// negative means we owe the party. Keep this conversion separate from the
// general journal convention (credit minus debit) so opening balances cannot
// accidentally swap their settlement queue.
export function openingStatementAmount(direction: OpeningBalanceDirection, amount: number): number {
  const magnitude = Math.abs(amount);
  return direction === "owes_us" ? magnitude : -magnitude;
}

export function openingLedgerSide(statementAmount: number): "debit" | "credit" | null {
  if (statementAmount === 0) return null;
  return statementAmount > 0 ? "debit" : "credit";
}
