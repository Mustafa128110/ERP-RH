// The first cutover keeps manual counterpart accounts deliberately small and
// explicit. They cover day-one corrections without allowing a user to post the
// other side back into AR/AP and conceal the real cause.
export const MANUAL_JOURNAL_COUNTERPARTS = [
  { code: "1000", name: "Cash and Bank" },
  { code: "1200", name: "Inventory" },
  { code: "3000", name: "Opening Balances Equity" },
  { code: "4000", name: "Sales Revenue" },
  { code: "4010", name: "Sales Returns" },
  { code: "4100", name: "Inventory Adjustment Gain" },
  { code: "5000", name: "Cost of Goods Sold" },
  { code: "6000", name: "Operating Expense" },
] as const;

export function isManualJournalCounterpart(value: string): value is (typeof MANUAL_JOURNAL_COUNTERPARTS)[number]["code"] {
  return MANUAL_JOURNAL_COUNTERPARTS.some((account) => account.code === value);
}
