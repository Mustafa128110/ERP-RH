export type PermissionModule = { module: string; actions: string[] };
export type AccessLevel = "none" | "view" | "work" | "full";

export function modulePermissionKeys(area: PermissionModule, level: AccessLevel): string[] {
  return area.actions.filter((action) => level === "full" || (level === "view" && ["view", "export"].includes(action)) || (level === "work" && ["view", "create", "edit", "export"].includes(action))).map((action) => `${area.module}.${action}`);
}

export function includeViewPermissions(keys: string[], catalog: PermissionModule[]): string[] {
  const result = new Set(keys);
  for (const area of catalog) if (area.actions.includes("view") && keys.some((key) => key.startsWith(`${area.module}.`))) result.add(`${area.module}.view`);
  return [...result];
}

export function presetPermissionKeys(catalog: PermissionModule[], preset: "sales" | "warehouse"): string[] {
  const levels: Record<string, AccessLevel> = preset === "sales"
    ? { sales: "work", invoices: "view", customers: "work", products: "view", stock: "view", quotations: "work" }
    : { products: "work", stock: "view", stock_transfers: "work", stock_adjustments: "work", locations: "view", units: "view", unit_conversions: "view", categories: "view", brands: "view" };
  return catalog.flatMap((area) => modulePermissionKeys(area, levels[area.module] ?? "none"));
}
