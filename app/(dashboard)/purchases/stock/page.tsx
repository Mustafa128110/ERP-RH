import { listStockPurchases } from "@/lib/actions/purchases";
import { getPurchaseFormOptions } from "@/lib/queries/lookups";
import { StockPurchaseManager } from "@/components/modules/StockPurchaseManager";
import { getSession } from "@/lib/auth/session";
import { formatDate, money, qty } from "@/lib/format";

export default async function Page() {
  const [purchases, options, session] = await Promise.all([listStockPurchases(), getPurchaseFormOptions(), getSession()]);

  // Only show locations the user has warehouse access for
  const warehouseIds = session?.warehouseIds ?? [];
  const filteredLocationOptions = warehouseIds.length > 0
    ? options.locationOptions.filter((l) => warehouseIds.includes(l.id))
    : options.locationOptions;

  const rows = purchases.map((p) => ({
    id: p.id,
    number: p.number,
    company: p.company,
    supplier: p.supplier ?? "—",
    total: money(p.grandTotal),
    date: formatDate(p.documentDate),
    paid: p.status === "cancelled" ? "Cancelled" : p.isPaid ? "Paid" : Number(p.paidAmount) > 0 ? "Partial Paid" : "Unpaid",
    breakdown: {
      subtotal: money(p.subtotal),
      discount: Number(p.discountTotal) > 0 ? money(p.discountTotal) : null,
      tax: Number(p.taxTotal) > 0 ? money(p.taxTotal) : null,
      shipping: Number(p.shippingTotal) > 0 ? money(p.shippingTotal) : null,
      total: money(p.grandTotal),
    },
    items: p.items.map((it) => ({
      itemName: it.itemName,
      qty: `${qty(it.quantity)} ${it.unitSymbol ?? ""}`.trim(),
      unit: [it.unitName, it.unitSymbol].filter(Boolean).join(" "),
      unitPrice: money(it.unitPrice),
      // Purchases saved before the shipping share was worked out per line have
      // no cost of their own; the price is the closest true thing to show.
      unitCost: money(it.unitCost ?? it.unitPrice),
      lineTotal: money(it.lineTotal),
    })),
    _searchItem: p.items.map((it) => it.itemName).join(" "),
    _searchUnit: p.items.flatMap((it) => [it.unitName, it.unitSymbol]).filter(Boolean).join(" "),
    _searchContact: p.supplier ?? "",
  }));

  return (
    <StockPurchaseManager
      rows={rows}
      {...options}
      locationOptions={filteredLocationOptions}
      canHardDelete={session?.globalPermissions.has("purchases.delete") ?? false}
    />
  );
}
