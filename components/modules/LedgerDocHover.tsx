"use client";

import type { ContactDocument } from "@/lib/actions/ledger";
import { DetailHover } from "@/components/ui/DetailHover";
import { money } from "@/lib/format";

function paidLabel(d: ContactDocument): string {
  const total = Number(d.grandTotal);
  const paid = Number(d.paidAmount);
  if (d.status === "cancelled") return "Cancelled";
  if (d.isPaid || paid >= total) return "Paid";
  if (paid > 0) return "Partial";
  return "Unpaid";
}

function paidColor(label: string): string {
  if (label === "Paid") return "text-emerald-600";
  if (label === "Partial") return "text-amber-600";
  return "text-red-500";
}

// Nested hover: the document number itself is hovered to show items.
function DocItemsHover({ doc }: { doc: ContactDocument }) {
  if (doc.items.length === 0) return <span>{doc.number}</span>;

  return (
    <DetailHover trigger={doc.number} width={300}>
      <div className="flex flex-col gap-0.5 text-sm">
        {doc.items.map((it, i) => (
          <div key={i} className="grid grid-cols-[1fr_auto_auto] gap-x-4">
            <span className="truncate text-ink">{it.itemName}</span>
            <span className="tabular-nums text-steel">{it.quantity}</span>
            <span className="text-right tabular-nums text-ink">{it.unitPrice}</span>
          </div>
        ))}
      </div>
      <div className="mt-2 border-t border-sand pt-2 text-xs text-steel">
        {doc.items.length} item{doc.items.length > 1 ? "s" : ""} · {money(doc.grandTotal)}
      </div>
    </DetailHover>
  );
}

export function LedgerDocHover({ docs, trigger }: {
  docs: ContactDocument[];
  trigger: string | number;
}) {
  return (
    <DetailHover trigger={trigger} width={340}>
      <div className="flex flex-col gap-0.5 text-sm">
        {docs.map((d) => (
          <div key={d.id} className="grid grid-cols-[auto_1fr_auto_auto] gap-x-3">
            <span className="tabular-nums text-ink">
              <DocItemsHover doc={d} />
            </span>
            <span className={`truncate ${paidColor(paidLabel(d))}`}>{paidLabel(d)}</span>
            <span className="text-right tabular-nums text-steel">{money(d.grandTotal)}</span>
            <span className="text-right tabular-nums text-steel text-xs">{money(d.paidAmount)}</span>
          </div>
        ))}
      </div>
    </DetailHover>
  );
}
