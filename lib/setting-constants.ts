// Lives outside lib/actions/settings.ts because that file is "use server", and
// such a module may only export async functions — same reason
// lib/sale-constants.ts exists.
//
// One entry per setting: the page renders the form from this list, the action
// validates against it, and a missing row falls back to the value here rather
// than to empty (a blank dead-stock threshold would make everything dead stock).

export type SettingDef = {
  key: string;
  label: string;
  help: string;
  kind: "number" | "text" | "tax" | "boolean" | "date";
  fallback: string;
  suffix?: string;
};

export function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

export const STOCK_COLUMN_SETTINGS = [
  {
    columnKey: "setup",
    settingKey: "show_stock_setup_column",
    label: "Setup",
    settingLabel: "Show Setup column on Stock page",
    help: "Show or hide the Setup status column on the Stock & Products table.",
  },
  {
    columnKey: "baseQuantity",
    settingKey: "show_stock_base_quantity_column",
    label: "Base Quantity",
    settingLabel: "Show Base Quantity column on Stock page",
    help: "Show or hide the Base Quantity dot column on the Stock & Products table.",
  },
  {
    columnKey: "unitRules",
    settingKey: "show_stock_unit_rules_column",
    label: "Unit Rules",
    settingLabel: "Show Unit Rules column on Stock page",
    help: "Show or hide the Unit Rules dot column on the Stock & Products table.",
  },
  {
    columnKey: "rate3",
    settingKey: "show_stock_purchase_rate_3_column",
    label: "Purchase Rate 3",
    settingLabel: "Show Purchase Rate 3 column on Stock page",
    help: "Show or hide the Purchase Rate 3 column on the Stock & Products table.",
  },
] as const;

export type StockToggleableColumnKey = (typeof STOCK_COLUMN_SETTINGS)[number]["columnKey"];
export type StockColumnVisibility = Record<StockToggleableColumnKey, boolean>;

export const DEFAULT_STOCK_COLUMN_VISIBILITY: StockColumnVisibility = {
  setup: true,
  baseQuantity: true,
  unitRules: true,
  rate3: true,
};

export function stockColumnVisibilityFromSettings(values: Record<string, string | undefined>): StockColumnVisibility {
  return {
    setup: values.show_stock_setup_column !== "false",
    baseQuantity: values.show_stock_base_quantity_column !== "false",
    unitRules: values.show_stock_unit_rules_column !== "false",
    rate3: values.show_stock_purchase_rate_3_column !== "false",
  };
}

export const SETTING_DEFS: SettingDef[] = [
  { key: "highlight_negative_stock", label: "Highlight negative stock rows", help: "Color the complete stock row red when its quantity is below zero.", kind: "boolean", fallback: "false" },
  { key: "highlight_low_stock", label: "Highlight below-reorder stock rows", help: "Color the complete stock row amber when its non-negative quantity is at or below the low-stock warning. Negative stock uses red.", kind: "boolean", fallback: "false" },
  ...STOCK_COLUMN_SETTINGS.map((col): SettingDef => ({
    key: col.settingKey,
    label: col.settingLabel,
    help: col.help,
    kind: "boolean",
    fallback: "true",
  })),
  {
    key: "dead_stock_days",
    label: "Dead-stock threshold",
    help: "An item with stock and no sale for this long shows up on the Dead / Slow Moving report.",
    kind: "number",
    fallback: "90",
    suffix: "days",
  },
  {
    key: "low_stock_qty",
    label: "Low-stock warning",
    help: "On-hand at or below this marks an item low on the Stock page.",
    kind: "number",
    fallback: "10",
    suffix: "units",
  },
  {
    key: "adjustment_approval_amount",
    label: "Adjustment approval threshold",
    help: "A stock adjustment worth more than this is flagged for a second pair of eyes.",
    kind: "number",
    fallback: "20000",
    suffix: "PKR",
  },
  {
    key: "invoice_footer",
    label: "Invoice footer",
    help: "Printed at the bottom of every invoice — terms, a bank account, a thank you.",
    kind: "text",
    fallback: "",
  },
  {
    key: "default_sales_tax_id",
    label: "Default sales tax",
    help: "Preselected on new sales. Tax is calculated only on products marked Taxable.",
    kind: "tax",
    fallback: "",
  },
  {
    key: "default_purchase_tax_id",
    label: "Default purchase tax",
    help: "Preselected on new stock purchases. It remains changeable per purchase.",
    kind: "tax",
    fallback: "",
  },
  {
    key: "tax_prices_include_tax",
    label: "Prices include tax",
    help: "When enabled, tax is extracted from entered prices instead of added on top.",
    kind: "boolean",
    fallback: "false",
  },
];
