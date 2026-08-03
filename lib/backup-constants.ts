// Lives outside lib/actions/backups.ts because that file is "use server", and
// such a module may only export async functions.

export type SnapshotTable = { key: string; label: string; description: string };

// Scoped to the user's companies wherever the table has a company. Ordered so a
// person reading the folder afterwards can rebuild the picture: what you sell,
// who you deal with, what moved.
export const SNAPSHOT_TABLES: SnapshotTable[] = [
  { key: "products", label: "Products", description: "The catalogue, with category and brand." },
  { key: "contacts", label: "Contacts", description: "Customers and suppliers." },
  { key: "stock", label: "Stock on hand", description: "Quantity and value per item and location." },
  { key: "sales", label: "Sales invoices", description: "Header and totals for every sale." },
  { key: "sale_lines", label: "Sale lines", description: "Every line of every sale." },
  { key: "purchases", label: "Purchase invoices", description: "Header and totals for every purchase." },
  { key: "purchase_lines", label: "Purchase lines", description: "Every line of every purchase." },
  { key: "payments", label: "Payments", description: "Money in and out, with the account it moved through." },
  { key: "expenses", label: "Expenses", description: "Every expense, with its category." },
  { key: "ledger", label: "Ledger entries", description: "The running balances behind each contact." },
];
