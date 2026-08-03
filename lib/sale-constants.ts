// Lives outside lib/actions/sales.ts because that file is "use server", and
// such a module may only export async functions. Same reason
// lib/adjustment-constants.ts and lib/location-constants.ts exist.
//
// Stored values are the documents.sale_type enum; the labels are what the shop
// calls them. Counter is the default — it's the bulk of every day's sales, and
// asking for it on every invoice is a question with a known answer.
export const SALE_TYPES = [
  { value: "counter", label: "Counter Sales" },
  { value: "balochistan", label: "Balochistan" },
  { value: "shopify", label: "Shopify" },
] as const;

export type SaleType = (typeof SALE_TYPES)[number]["value"];

export const DEFAULT_SALE_TYPE: SaleType = "counter";

export const isSaleType = (value: string): value is SaleType => SALE_TYPES.some((t) => t.value === value);

export const saleTypeLabel = (value: string | null): string => SALE_TYPES.find((t) => t.value === value)?.label ?? "—";
