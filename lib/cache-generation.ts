import { READ_DEPENDS_ON, type ReadDomain } from "./cache-keys";

// Unknown cache families depend on every tracked table. Missing a dependency
// must cost a cache hit, never make a stale entry look authoritative.
const lookupTables: Record<string, string[]> = {
  companies: ["companies"], categories: ["categories"], brands: ["brands"], locations: ["locations"],
  units: ["units"], taxes: ["taxes"], settings: ["settings"], document_types: ["document_types"],
  expense_categories: ["expense_categories"], roles: ["roles", "role_permissions", "permissions"],
  contacts: ["contacts"], bank_accounts: ["bank_accounts"], cash_accounts: ["cash_accounts"],
  items: ["items", "document_lines", "documents", "document_types", "inventory_transactions", "unit_conversions", "item_unit_conversion_rules", "units"],
  cheques: ["cheque_register", "documents", "expenses", "bank_accounts", "cash_accounts"],
};
const snake = (value: string) => value.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
export function cacheGeneration(key: string, versions: Record<string, string>): string {
  const [family, domain] = key.split(":");
  const tables = family === "page_reads" && Object.hasOwn(READ_DEPENDS_ON, domain)
    ? [...READ_DEPENDS_ON[domain as ReadDomain], "documentTypes"].map(snake)
    : lookupTables[family] ?? Object.keys(versions);
  // Include names as well as counters so newly tracked tables cannot collide.
  return [...new Set(tables)].sort().map(name => `${name}=${versions[name] ?? "missing"}`).join(";");
}
