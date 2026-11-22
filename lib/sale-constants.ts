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

export type SaleType = string;

export const DEFAULT_SALE_TYPE: SaleType = "counter";

export const isSaleType = (value: string): value is SaleType => /^[a-z0-9][a-z0-9_-]{0,79}$/.test(value);

export const saleTypeLabel = (value: string | null, channels: readonly { id: string; name: string }[] = []): string => channels.find((channel) => channel.id === value)?.name ?? SALE_TYPES.find((t) => t.value === value)?.label ?? value ?? "—";

export const CHANNEL_COOKIE = "scope_channel";

export function entryChannel(channels: readonly { id: string; isActive: boolean }[], selected: string): string {
  return channels.some((channel) => channel.id === selected && channel.isActive) ? selected
    : channels.find((channel) => channel.id === DEFAULT_SALE_TYPE && channel.isActive)?.id
      ?? channels.find((channel) => channel.isActive)?.id ?? DEFAULT_SALE_TYPE;
}
