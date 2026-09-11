// Identifiers are from this static map, never interpolated from a request.
export const COMMAND_TABLES: Record<string, string> = {
  brands: "brands", categories: "categories", companies: "companies", contacts: "contacts",
  expenses: "expenses", "inter-company": "documents", ledger: "contacts", locations: "locations",
  "market-purchases": "market_purchase_requests", payments: "documents", products: "items",
  purchases: "documents", quotations: "documents", returns: "documents", roles: "roles", sales: "documents",
  "stock-adjustments": "documents", "stock-transfers": "documents", taxes: "taxes", transfers: "documents",
  "unit-conversions": "unit_conversions", units: "units",
};
export function tableForCommand(action: string): string | undefined {
  const [module, name] = action.split(".");
  if (module === "accounts") return name.includes("Bank") ? "bank_accounts" : name.includes("Cash") ? "cash_accounts" : "cheque_register";
  return COMMAND_TABLES[module];
}
