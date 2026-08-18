import { listStockPurchases } from "@/lib/actions/purchases";
import { getPurchaseFormOptions } from "@/lib/queries/lookups";
import { StockPurchaseManager } from "@/components/modules/StockPurchaseManager";
import { formatDate, money, qty } from "@/lib/format";

export default async function Page({ searchParams }: { searchParams: Promise<{ company?: string }> }) {
  const { company } = await searchParams;
  const [purchases, options] = await Promise.all([listStockPurchases(company || undefined), getPurchaseFormOptions()]);


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
      unitPrice: money(it.unitPrice),
      // Purchases saved before the shipping share was worked out per line have
      // no cost of their own; the price is the closest true thing to show.
      unitCost: money(it.unitCost ?? it.unitPrice),
      lineTotal: money(it.lineTotal),
    })),
  }));

  return <StockPurchaseManager rows={rows} companyId={company || undefined} {...options} />;
}
