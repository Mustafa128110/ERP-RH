// Cache keys live in a dependency-free module so transaction helpers can
// invalidate a lookup without importing the authenticated lookup queries (and
// their Next navigation dependencies) into offline checks.
export const CACHE = {
  companies: "companies",
  categories: "categories",
  brands: "brands",
  locations: "locations",
  units: "units",
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
  // Short-lived, permission-keyed page read models. Every mutation clears this
  // prefix after commit so warm navigations never pay the remote DB round trip
  // and a completed write can never leave an old list on screen.
  pageReads: "page_reads",
} as const;
