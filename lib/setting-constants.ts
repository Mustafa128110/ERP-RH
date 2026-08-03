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
  kind: "number" | "text";
  fallback: string;
  suffix?: string;
};

export const SETTING_DEFS: SettingDef[] = [
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
];
