"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { convertQuotation, type QuotationLine } from "@/lib/actions/quotations";
import { Dialog } from "@/components/ui/Dialog";
import { DateField } from "@/components/ui/DateField";
import { errorTextClass, labelClass, labelTextClass, primaryActionClass, secondaryActionClass } from "@/components/ui/form-styles";
import { money, round1, todayISO } from "@/lib/format";

const thClass = "border border-sand px-2 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-steel";
const cellInput = "h-9 w-full min-w-0 bg-transparent px-2 text-right text-sm tabular-nums text-ink outline-none focus:bg-navy-800/5";

// Turning quoted lines into an invoice. Each line offers whatever is left on it,
// pre-filled and reducible — which is what makes "half the tiles now, the rest
// when the second floor is ready" a normal thing to do rather than two
// quotations and a note.
export function ConvertQuotationDialog({
  quotationId,
  lines,
  onClose,
}: {
  quotationId: string;
  lines: QuotationLine[];
  onClose: () => void;
}) {
  const router = useRouter();
  const remaining = lines.map((l) => round1(Number(l.quantity) - Number(l.convertedQuantity)));

  // Lines with nothing left start unticked and can't be ticked — there is
  // nothing on them to invoice.
  const [take, setTake] = useState<Record<number, string>>(() =>
    Object.fromEntries(remaining.map((r, i) => [i, r > 0 ? String(r) : ""])),
  );
  const [documentDate, setDocumentDate] = useState(todayISO());
  const [state, action, pending] = useActionState(convertQuotation.bind(null, quotationId), undefined);

  useEffect(() => {
    if (state?.invoiceId) router.push(`/sales/invoices/${state.invoiceId}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.invoiceId]);

  const chosen = Object.entries(take).filter(([i, v]) => Number(v) > 0 && remaining[Number(i)] > 0);
  const total = chosen.reduce((sum, [i, v]) => sum + Number(v) * Number(lines[Number(i)].unitPrice), 0);

  return (
    <Dialog
      title="Convert to Invoice"
      onClose={onClose}
      size="wide"
      footer={
        <form action={action} className="flex flex-wrap items-center justify-between gap-3 sm:gap-4">
          <input type="hidden" name="quantitiesJson" value={JSON.stringify(Object.fromEntries(chosen))} />
          <input type="hidden" name="documentDate" value={documentDate} />
          <div className="flex items-center gap-3">
            <span className="text-sm text-steel">Invoice total</span>
            <span className="text-base font-semibold tabular-nums text-navy-800">{money(round1(total))}</span>
          </div>
          <div className="flex items-center gap-3">
            {state?.error && <p className={errorTextClass}>{state.error}</p>}
            <button type="button" onClick={onClose} className={secondaryActionClass}>
              Cancel
            </button>
            <button type="submit" disabled={pending || chosen.length === 0} className={primaryActionClass}>
              {pending ? "Raising invoice…" : "Raise Invoice"}
            </button>
          </div>
        </form>
      }
    >
      <div className="flex flex-col gap-4">
        <label className={`${labelClass} w-44`}>
          <span className={labelTextClass}>Invoice Date</span>
          <DateField
            value={documentDate}
            onChange={setDocumentDate}
            className="h-11 rounded border border-sand px-3 text-sm text-ink focus:border-navy-800"
          />
        </label>

        <p className="text-sm text-steel">
          The quoted rate carries over untouched. Stock moves and the customer&apos;s balance updates when the invoice is raised — the quotation itself never
          touched either.
        </p>

        <div className="scroll-thin -mx-1 overflow-x-auto px-1">
          <table className="w-full min-w-max border-collapse">
          <thead>
            <tr className="bg-ivory">
              <th className={thClass}>Item</th>
              <th className={`${thClass} text-right`}>Quoted</th>
              <th className={`${thClass} text-right`}>Already invoiced</th>
              <th className={`${thClass} text-right`}>Left</th>
              <th className={`${thClass} text-right`}>Invoice now</th>
              <th className={`${thClass} text-right`}>Rate</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, i) => (
              <tr key={i} className={remaining[i] <= 0 ? "text-steel" : ""}>
                <td className="border border-sand px-2 py-1.5 text-sm">{line.itemName || "—"}</td>
                <td className="border border-sand px-2 py-1.5 text-right text-sm tabular-nums">{line.quantity}</td>
                <td className="border border-sand px-2 py-1.5 text-right text-sm tabular-nums">{line.convertedQuantity}</td>
                <td className="border border-sand px-2 py-1.5 text-right text-sm tabular-nums">{remaining[i]}</td>
                <td className="border border-sand p-0">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max={remaining[i]}
                    value={take[i] ?? ""}
                    disabled={remaining[i] <= 0}
                    onChange={(e) => setTake((prev) => ({ ...prev, [i]: e.target.value }))}
                    aria-label={`Quantity to invoice for ${line.itemName}`}
                    className={cellInput}
                  />
                </td>
                <td className="border border-sand px-2 py-1.5 text-right text-sm tabular-nums">{money(line.unitPrice)}</td>
              </tr>
            ))}
          </tbody>
          </table>
        </div>
      </div>
    </Dialog>
  );
}
