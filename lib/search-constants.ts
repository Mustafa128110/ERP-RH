// Lives outside lib/actions/search.ts because that file is "use server", and
// such a module may only export async functions — same reason
// lib/sale-constants.ts, lib/setting-constants.ts and lib/preference-constants.ts
// exist. A type exported from a "use server" module is not merely untidy: the
// server-actions loader re-exports every export by name, and a re-exported type
// erases to a reference to nothing, which fails at module evaluation and takes
// down every route that touches the action.
//
// Also outside lib/queries/search.ts, which imports "server-only" — the top
// bar's search box is a client component and has to be able to read the labels.

export type SearchKind =
  | "product"
  | "contact"
  | "invoice"
  | "purchase"
  | "quotation"
  | "payment"
  | "expense"
  | "transfer"
  | "adjustment"
  | "category"
  | "brand"
  | "unit"
  | "location"
  | "tax"
  | "company"
  | "user"
  | "role";

export type SearchHit = {
  kind: SearchKind;
  id: string;
  title: string;
  subtitle: string;
  href: string;
};

// Per kind, not overall: three of each beats twenty products and nothing else.
// With seventeen kinds this is also what keeps the whole statement bounded —
// worst case is 17 × 3 rows, no matter how common the term is.
export const PER_KIND = 3;

// What each kind is called in the dropdown.
export const KIND_LABEL: Record<SearchKind, string> = {
  product: "Product",
  contact: "Contact",
  invoice: "Invoice",
  purchase: "Purchase",
  quotation: "Quotation",
  payment: "Payment",
  expense: "Expense",
  transfer: "Transfer",
  adjustment: "Adjustment",
  category: "Category",
  brand: "Brand",
  unit: "Unit",
  location: "Location",
  tax: "Tax",
  company: "Company",
  user: "User",
  role: "Role",
};

// Where each kind of hit goes when it's chosen. Most master data has no detail
// page of its own — it is edited from its list — so those land on the list,
// which has a search box of its own to finish the job.
export const SEARCH_HREF: Record<SearchKind, (id: string) => string> = {
  product: () => "/inventory/products",
  contact: () => "/purchases/suppliers",
  invoice: (id) => `/sales/invoices/${id}`,
  purchase: () => "/purchases/stock",
  quotation: (id) => `/sales/quotations/${id}`,
  transfer: (id) => `/inventory/stock-transfers/${id}`,
  adjustment: (id) => `/inventory/stock-adjustments/${id}`,
  payment: () => "/payments",
  expense: () => "/expenses",
  category: () => "/inventory/categories",
  brand: () => "/inventory/brands",
  unit: () => "/inventory/units",
  location: () => "/inventory/warehouses",
  tax: () => "/taxes",
  company: () => "/companies",
  user: () => "/users",
  role: () => "/roles",
};
