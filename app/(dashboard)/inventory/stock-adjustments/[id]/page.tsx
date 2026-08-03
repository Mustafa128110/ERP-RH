import Link from "next/link";
import { notFound } from "next/navigation";
import { getStockAdjustment } from "@/lib/actions/stock-adjustments";
import { DeleteStockAdjustmentButton } from "@/components/modules/StockAdjustmentForm";
import { formatDate, qty as formatQty } from "@/lib/format";

const thClass = "px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-steel";
const tdClass = "px-4 py-2.5 text-ink";

function qty(value: string) {
  // Signed on purpose: a write-off reads as negative at a glance.
  const n = Number(value);
  return `${n > 0 ? "+" : ""}${formatQty(n)}`;
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const adjustment = await getStockAdjustment(id);
  if (!adjustment) notFound();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between">
        <div>
          <Link href="/inventory/stock-adjustments" className="text-sm text-steel hover:text-navy-800">
            ← Stock Adjustments
          </Link>
          <h1 className="mt-1 text-xl text-navy-800">{adjustment.number}</h1>
          <p className="text-sm text-steel">
            {adjustment.location} · {adjustment.reason ?? "No reason recorded"} · {formatDate(adjustment.documentDate)} · {adjustment.status}
          </p>
        </div>
        <DeleteStockAdjustmentButton adjustmentId={adjustment.id} />
      </div>

      {/* Read-only: the movements are already posted, so an adjustment is deleted
          and re-entered rather than edited in place. */}
      <div className="overflow-x-auto rounded-lg border border-sand">
        <table className="w-full min-w-max border-collapse text-sm">
          <thead>
            <tr className="border-b border-sand bg-ivory">
              <th className={`${thClass} text-right`}>#</th>
              <th className={thClass}>SKU</th>
              <th className={thClass}>Item</th>
              <th className={`${thClass} text-right`}>Adjusted By</th>
            </tr>
          </thead>
          <tbody>
            {adjustment.lines.map((l, i) => (
              <tr key={i} className="border-b border-sand last:border-0">
                <td className={`${tdClass} text-right tabular-nums text-steel`}>{i + 1}</td>
                <td className={tdClass}>{l.sku || "—"}</td>
                <td className={tdClass}>{l.itemName}</td>
                <td className={`${tdClass} text-right tabular-nums ${Number(l.quantity) < 0 ? "text-error" : ""}`}>
                  {qty(l.quantity)} {l.unitSymbol ?? ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
