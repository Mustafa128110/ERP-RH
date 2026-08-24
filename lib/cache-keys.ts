// Cache keys live in a dependency-free module so transaction helpers can
// invalidate a lookup without importing the authenticated lookup queries (and
// their Next navigation dependencies) into offline checks.
export const CACHE = {
  companies: "companies",
  categories: "categories",
  brands: "brands",
  locations: "locations",
  units: "units",
  taxes: "taxes",
  settings: "settings",
  documentTypes: "document_types",
  expenseCategories: "expense_categories",
  roles: "roles",
  items: "items",
  contacts: "contacts",
  bankAccounts: "bank_accounts",
  cashAccounts: "cash_accounts",
  cheques: "cheques",
  dashboard: "dashboard",
  reports: "reports",
  // Short-lived, permission-keyed page read models, one prefix per read domain
  // below. A mutation clears the domains its write can actually change rather
  // than this whole prefix, so renaming a brand no longer costs every list on
  // every screen its cache entry.
  pageReads: "page_reads",
} as const;

// The cached list reads, one per screen that has one. The name is the second
// segment of the cache key (`page_reads:<domain>:<userId>:…`), which is what lets
// invalidate() drop one screen's reads and leave the rest warm — it clears a key
// and every `key:` variant of it.
export const READ_DOMAIN = {
  sales: "sales",
  purchases: "purchases",
  payments: "payments",
  ledger: "ledger",
  expenses: "expenses",
  stock: "stock",
  products: "products",
  // Bank accounts, cash accounts and the cheque register are one domain because
  // the accounts screen reads all three on every open — splitting them would
  // save nothing and give three chances to miss one.
  accounts: "accounts",
} as const;

export type ReadDomain = (typeof READ_DOMAIN)[keyof typeof READ_DOMAIN];

// What each cached read actually selects, by Drizzle table export name. Read off
// the queries themselves, not from intuition — a domain that omits a table it
// joins will serve a stale list for the whole TTL, which is the one way precise
// invalidation is worse than the blanket drop it replaces.
//
// lib/cache.check.ts inverts this into table -> domains and holds every mutating
// action to naming every domain its writes can reach, so a join added here
// without a matching invalidation becomes a failing check rather than a list that
// quietly stops updating.
// `documentTypes` is deliberately absent from every list below even though most of
// the reads join it. Its rows are insert-only — ensureDocumentType
// (lib/actions/document-numbering.ts) upserts a row's code back to the value it
// already has, and nothing in lib/actions ever updates or deletes one — so a type
// that exists cannot change, and a type that has just been created has no
// documents to appear beside. A dependency on it would only make the first sale
// entered for a new company clear five screens for nothing.
export const READ_DEPENDS_ON: Record<ReadDomain, readonly string[]> = {
  // listSales (lib/actions/sales.ts): documents + their lines, with the customer
  // name and the company's short name joined in.
  sales: ["documents", "documentLines", "companies", "contacts", "items", "units"],
  // listStockPurchases — the same shape on the buying side.
  purchases: ["documents", "documentLines", "companies", "contacts", "items", "units"],
  // listPayments, which also names the account or cheque that settled each one.
  payments: ["documents", "companies", "contacts", "bankAccounts", "cashAccounts", "chequeRegister"],
  // listLedger: the entries, plus recent payments and invoices per contact. The
  // settlement accounts are joined to drop payments booked against another
  // company's account, so a bank or cash account change can change this list.
  ledger: ["ledgerEntries", "documents", "companies", "contacts", "bankAccounts", "cashAccounts"],
  // listExpenses, down to who entered each one.
  expenses: ["expenses", "expenseCategories", "companies", "bankAccounts", "cashAccounts", "chequeRegister", "users"],
  // Stock on hand is the movement ledger grouped by item, unit and location —
  // and it reads each company's low_stock_qty to mark a row low, so a settings
  // change changes what this returns.
  stock: ["inventoryTransactions", "documentLines", "items", "units", "locations", "companies", "settings"],
  // Product rates come through the rate_list view (purchase lines) with the last
  // sales price and on-hand joined on, so anything that moves stock or prices
  // changes them.
  products: ["items", "categories", "brands", "companies", "documents", "documentLines", "inventoryTransactions"],
  // Three plain selects, no joins.
  accounts: ["bankAccounts", "cashAccounts", "chequeRegister"],
};

// Which document types each list can actually show. `documents` and
// `document_lines` are one table each for every kind of document in the system —
// sale, purchase, payment, quotation, cash transfer, stock movement, journal
// entry — so a table-level dependency would have entering a payment clear the
// sales list. Every cached read that selects them filters on document_types.code,
// so the honest dependency is (table, code) -> domain, and that is what
// lib/cache.check.ts uses.
//
// An empty list does not mean "no documents". It means the domain reaches those
// tables only through another table's rows: stock and products join
// document_lines from inventory_transactions, so a document that moved no stock
// cannot change them — and both are already listed as depending on
// inventoryTransactions, which is what a write that does move stock touches.
export const READ_DOCUMENT_TYPES: Record<ReadDomain, readonly string[]> = {
  sales: ["SALES_INVOICE"],
  purchases: ["PURCHASE_INVOICE"],
  // Payments proper, plus purchases settled on the spot — listPayments takes both
  // in one or(), because paying a supplier at the counter is money out whether it
  // was entered as a payment or ticked "paid" on the delivery.
  payments: ["PAYMENT_MADE", "PAYMENT_RECEIVED", "PURCHASE_INVOICE"],
  // The entries carry the balance; the documents joined in are the recent
  // invoices shown per contact.
  ledger: ["SALES_INVOICE", "PURCHASE_INVOICE"],
  // Last sales price is a SALES_INVOICE lateral; the three purchase rates come
  // from the rate_list view over purchase lines.
  products: ["SALES_INVOICE", "PURCHASE_INVOICE"],
  stock: [],
  expenses: [],
  accounts: [],
};
