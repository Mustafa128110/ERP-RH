import type { SearchKind } from "@/lib/search-constants";

export type TableSearchTerm = { field: string | null; value: string };

const ENTITY_KEYS: Record<string, readonly string[]> = {
  item: ["_searchItem", "item", "itemName", "product", "productName"],
  product: ["_searchItem", "item", "itemName", "product", "productName"],
  unit: ["_searchUnit", "unit", "unitName", "unitSymbol"],
  contact: ["_searchContact", "contact", "contactName", "customer", "customerName", "supplier", "supplierName", "displayName"],
  customer: ["_searchContact", "contact", "contactName", "customer", "customerName", "displayName"],
  supplier: ["_searchContact", "contact", "contactName", "supplier", "supplierName", "displayName"],
};

const GLOBAL_KIND: Record<string, SearchKind> = {
  item: "product",
  product: "product",
  contact: "contact",
  invoice: "invoice",
  sale: "invoice",
  purchase: "purchase",
  quotation: "quotation",
  quote: "quotation",
  payment: "payment",
  expense: "expense",
  transfer: "transfer",
  adjustment: "adjustment",
  category: "category",
  brand: "brand",
  unit: "unit",
  location: "location",
  warehouse: "location",
  tax: "tax",
  company: "company",
  user: "user",
  role: "role",
};

function normalize(value: string) {
  return value.trim().toLowerCase();
}

// Space-separated terms retain the existing "all words must match" behavior.
// Quotes keep a multi-word value together: contact:"Ali Hardware".
export function parseTableSearch(query: string): TableSearchTerm[] {
  const terms: TableSearchTerm[] = [];
  const pattern = /(?:^|\s)(?:([a-z][\w-]*):)?(?:"([^"]+)"|(\S+))/gi;
  for (const match of query.matchAll(pattern)) {
    const rawField = normalize(match[1] ?? "");
    const value = normalize(match[2] ?? match[3] ?? "");
    if (!value) continue;
    terms.push({ field: rawField || null, value });
  }
  return terms;
}

function primitiveText(value: unknown): string {
  return value === null || value === undefined || typeof value === "boolean" || typeof value === "object"
    ? ""
    : normalize(String(value));
}

function fieldValues(row: Record<string, unknown>, field: string): string[] {
  const direct = Object.keys(row).filter((key) => normalize(key) === field);
  const keys = ENTITY_KEYS[field] ? [...new Set([...ENTITY_KEYS[field], ...direct])] : direct;
  return keys.map((key) => primitiveText(row[key])).filter(Boolean);
}

export function matchesTableSearch(row: Record<string, unknown>, allText: string, terms: TableSearchTerm[]): boolean {
  return terms.every((term) => {
    if (!term.field) return allText.includes(term.value);
    const values = fieldValues(row, term.field);
    return values.length > 0 && values.some((value) => value.includes(term.value));
  });
}

export function parseGlobalSearch(query: string): { term: string; kind?: SearchKind } {
  const trimmed = query.trim();
  const match = trimmed.match(/^([a-z][\w-]*)\s*:\s*(.*)$/i);
  if (!match) return { term: trimmed };
  const kind = GLOBAL_KIND[normalize(match[1])];
  if (!kind) return { term: trimmed };
  const rawTerm = match[2].trim();
  const term = rawTerm.startsWith('"') && rawTerm.endsWith('"') ? rawTerm.slice(1, -1).trim() : rawTerm;
  return { term, kind };
}
