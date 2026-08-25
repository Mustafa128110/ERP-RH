import { listSales } from "@/lib/actions/sales";
import { getSaleFormOptions } from "@/lib/queries/lookups";
import { InvoiceManager } from "@/components/modules/InvoiceManager";
import { formatDate, money } from "@/lib/format";
import { saleTypeLabel } from "@/lib/sale-constants";
import type { Row } from "@/lib/table";

export const dynamic = "force-dynamic";

// Every SALES_INVOICE, which is what /sales used to list before that route
// became the entry form. This page answers both questions the shop asks of a
// sale after the fact: what is still owed, and "open that one, it's wrong" —
// the latter in a popup running the same form that entered it.

// Days since the invoice was raised. Local time, not UTC — at UTC+5 an evening
// invoice would otherwise show as a day old the moment it was written.
function daysOld(documentDate: string) {
  const today = new Date(new Date().toLocaleDateString("en-CA"));
  const raised = new Date(documentDate);
  return Math.max(0, Math.round((today.getTime() - raised.getTime()) / 86_400_000));
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ customer?: string; status?: string; saleType?: string; from?: string; to?: string }>;
}) {
  const { status, ...listFilters } = await searchParams;
  const [sales, formOptions] = await Promise.all([listSales(listFilters), getSaleFormOptions()]);
  const filtered = Boolean(status) || Object.values(listFilters).some(Boolean);

  const invoices = sales
    .map((s) => ({ ...s, balance: s.status === "cancelled" ? 0 : Number(s.grandTotal) - Number(s.paidAmount), age: daysOld(s.documentDate) }))
    .filter((s) => (status === "outstanding" ? s.status === "posted" && s.balance > 0 : status === "paid" ? s.status === "posted" && s.balance <= 0 : true))
    // Outstanding first and oldest of those at the top — the one that has been
    // waiting longest is the one to chase. Settled invoices sit below, newest
    // first, where they're only ever looked up by number.
    .sort((a, b) => {
      const aOwed = a.balance > 0;
      const bOwed = b.balance > 0;
      if (aOwed !== bOwed) return aOwed ? -1 : 1;
      return aOwed ? b.age - a.age : a.age - b.age;
    });

  const outstanding = invoices.reduce((sum, s) => sum + Math.max(s.balance, 0), 0);

  // Items per invoice for the customer hover panel.
  const itemsBySaleId = new Map(
    sales.map((s) => [
      s.id,
      s.items.map((it) => ({
        name: it.itemName,
        qty: `${Number(it.quantity)}${it.unitSymbol ? ' ' + it.unitSymbol : ''}`.trim(),
        rate: money(it.unitPrice),
      })),
    ]),
  );

  const rows: Row[] = invoices.map((s) => {
    const lineItems = itemsBySaleId.get(s.id) ?? [];
    return {
      id: s.id,
      number: s.number,
      customer: s.customer ?? "—",
      company: s.company ?? "—",
      saleType: saleTypeLabel(s.saleType),
      date: formatDate(s.documentDate),
      age: s.balance > 0 ? `${s.age}d` : "—",
      total: money(s.grandTotal),
      paid: money(s.paidAmount),
      balance: s.balance > 0 ? money(s.balance) : "—",
      status: s.status === "cancelled" ? "Cancelled" : s.isPaid ? "Paid" : Number(s.paidAmount) > 0 ? "Partial" : "Unpaid",
      // Not rendered as a column, but DataTable's search haystack scans every
      // value on the row — so without this, an invoice whose customer/company
      // columns don't mention it would be missed by a search for an item name.
      itemNames: lineItems.map((it) => it.name).join(" "),
    };
  });

  return (
    <InvoiceManager
      rows={rows}
      count={invoices.length}
      outstanding={outstanding}
      filtered={filtered}
      formOptions={formOptions}
      itemsBySaleId={itemsBySaleId}
    />
  );
}
