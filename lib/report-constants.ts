// Lives outside lib/actions/reports.ts because that file is "use server", and
// such a module may only export async functions — the same reason
// lib/sale-constants.ts and lib/location-constants.ts exist.
//
// The list is here rather than in the page so a new report is one entry beside
// its SQL, not an entry in one file kept in step with a query in another.

export const REPORT_TYPES = [
  { slug: "sales", label: "Sales", desc: "What was sold, by day, company and channel." },
  { slug: "profit", label: "Profit", desc: "Margin using cost-at-sale, not today's cost." },
  { slug: "expenses", label: "Expenses", desc: "By category and company." },
  { slug: "inventory", label: "Inventory", desc: "Quantity on hand and what it is worth." },
  { slug: "warehouse-stock", label: "Warehouse Stock", desc: "The same, split by location." },
  { slug: "customer-ledger", label: "Customer Ledger", desc: "What each customer owes, per company." },
  { slug: "supplier-ledger", label: "Supplier Ledger", desc: "What is owed to each supplier, per company." },
  { slug: "receivables-payables", label: "Receivables / Payables", desc: "Outstanding invoices by age." },
  { slug: "dead-stock", label: "Dead / Slow Moving", desc: "Stock that has not sold lately." },
  { slug: "purchase", label: "Purchase", desc: "What was bought, from whom." },
  { slug: "gst", label: "GST", desc: "Tax charged on sales and paid on purchases." },
  { slug: "trial-balance", label: "Trial Balance", desc: "Cumulative general-ledger balances through the selected end date." },
  { slug: "general-ledger", label: "General Ledger", desc: "Every post-cutover debit and credit, including its source and lifecycle status." },
] as const;

export type ReportSlug = (typeof REPORT_TYPES)[number]["slug"];

// Narrows a URL segment to a report that exists, so the page can 404 on
// anything else rather than reaching a query that isn't there.
export function isReportSlug(value: string): value is ReportSlug {
  return REPORT_TYPES.some((r) => r.slug === value);
}
