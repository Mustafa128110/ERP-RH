export type GeneralLedgerLine = {
  accountCode?: string;
  accountId?: string;
  debit?: number;
  credit?: number;
  memo?: string;
};

// These are deliberately company-local control accounts. They make a clean
// cutover possible without silently combining the balances of two companies.
// The setup screen can create them before the first posting, while the posting
// path also keeps this list as a safe backstop.
export const SYSTEM_GENERAL_LEDGER_ACCOUNTS = [
  { code: "1000", name: "Cash and Bank", accountType: "asset" as const },
  { code: "1100", name: "Accounts Receivable", accountType: "asset" as const },
  { code: "1200", name: "Inventory", accountType: "asset" as const },
  { code: "2000", name: "Accounts Payable", accountType: "liability" as const },
  { code: "3000", name: "Opening Balances Equity", accountType: "equity" as const },
  { code: "4000", name: "Sales Revenue", accountType: "income" as const },
  { code: "4010", name: "Sales Returns", accountType: "income" as const },
  { code: "4100", name: "Inventory Adjustment Gain", accountType: "income" as const },
  { code: "5000", name: "Cost of Goods Sold", accountType: "expense" as const },
  { code: "6000", name: "Operating Expense", accountType: "expense" as const },
] as const;

const money = (value: number) => Number(value.toFixed(2));

export function balancedGeneralLedgerLines(lines: GeneralLedgerLine[]): { debit: number; credit: number; balanced: boolean } {
  const debit = money(lines.reduce((sum, line) => sum + (line.debit ?? 0), 0));
  const credit = money(lines.reduce((sum, line) => sum + (line.credit ?? 0), 0));
  return { debit, credit, balanced: debit > 0 && debit === credit };
}

export function isOnOrAfterGlCutover(documentDate: string, cutoverDate: string | null | undefined) {
  return Boolean(cutoverDate && documentDate >= cutoverDate);
}

// Inventory adjustments are not sales. A loss is an expense; a count gain is
// income. Zero-valued adjustments still move quantity but have no financial
// entry, which keeps the GL check from inventing a zero-money posting.
export function stockAdjustmentLedgerLines(rows: { movement: 1 | -1; cost: number }[]): GeneralLedgerLine[] {
  return rows.flatMap((row) => {
    const cost = money(Math.abs(row.cost));
    if (cost === 0) return [];
    return row.movement === -1
      ? [
          { accountCode: "6000", debit: cost, memo: "Inventory adjustment loss" },
          { accountCode: "1200", credit: cost, memo: "Inventory adjusted down" },
        ]
      : [
          { accountCode: "1200", debit: cost, memo: "Inventory adjusted up" },
          { accountCode: "4100", credit: cost, memo: "Inventory adjustment gain" },
        ];
  });
}

// `ledger_entries` records the party half only. These lines add its actual GL
// counterpart: receivable for a party owing us, payable for us owing a party.
// A manual correction must name its other account rather than disappearing into
// an untraceable default.
export function partyJournalLedgerLines(partyLedgerSignedAmount: number, counterpartAccountCode: string): GeneralLedgerLine[] {
  const amount = money(Math.abs(partyLedgerSignedAmount));
  if (amount === 0) return [];
  return partyLedgerSignedAmount < 0
    ? [
        { accountCode: "1100", debit: amount, memo: "Party receivable" },
        { accountCode: counterpartAccountCode, credit: amount, memo: "Manual journal counterpart" },
      ]
    : [
        { accountCode: counterpartAccountCode, debit: amount, memo: "Manual journal counterpart" },
        { accountCode: "2000", credit: amount, memo: "Party payable" },
      ];
}

export function openingBalanceLedgerLines(statementSignedAmount: number): GeneralLedgerLine[] {
  const amount = money(Math.abs(statementSignedAmount));
  if (amount === 0) return [];
  return statementSignedAmount > 0
    ? [
        { accountCode: "1100", debit: amount, memo: "Opening receivable" },
        { accountCode: "3000", credit: amount, memo: "Opening balances equity" },
      ]
    : [
        { accountCode: "3000", debit: amount, memo: "Opening balances equity" },
        { accountCode: "2000", credit: amount, memo: "Opening payable" },
      ];
}

// Each company is a separate legal book. An inter-company transfer is therefore
// a sale with a receivable in the seller and a purchase with a payable in the
// buyer, even though the workflow creates both documents together.
export function interCompanySellerLedgerLines(total: number, inventoryCost: number): GeneralLedgerLine[] {
  const lines: GeneralLedgerLine[] = [
    { accountCode: "1100", debit: money(total), memo: "Inter-company receivable" },
    { accountCode: "4000", credit: money(total), memo: "Inter-company revenue" },
  ];
  if (inventoryCost > 0) {
    lines.push(
      { accountCode: "5000", debit: money(inventoryCost), memo: "Inter-company cost of goods sold" },
      { accountCode: "1200", credit: money(inventoryCost), memo: "Inventory issued to related company" },
    );
  }
  return lines;
}

export function interCompanyBuyerLedgerLines(total: number): GeneralLedgerLine[] {
  return [
    { accountCode: "1200", debit: money(total), memo: "Inter-company inventory received" },
    { accountCode: "2000", credit: money(total), memo: "Inter-company payable" },
  ];
}
