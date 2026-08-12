"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { listPurchaseMergeCandidates, mergeStockPurchases, type PurchaseMergeCandidate } from "@/lib/actions/purchases";
import { Dialog } from "@/components/ui/Dialog";
import { inputClass, submitClass, errorTextClass } from "@/components/ui/form-styles";
import { formatDate, money } from "@/lib/format";

// Gathering several purchases into one. One delivery entered as three notes, or
// the same note keyed twice, leaves a supplier owed four separate amounts for
// what was one drop. Tick the ones that belong together, say which number
// survives, and every line moves onto it.
//
// The lines carry their inventory_transactions with them, so stock and valuation
// come out identical — this changes the paperwork, not what's on the shelf.
export function MergePurchasesDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [candidates, setCandidates] = useState<PurchaseMergeCandidate[] | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [survivorId, setSurvivorId] = useState("");

  const [state, action, pending] = useActionState(mergeStockPurchases, undefined);

  // Loaded when the dialog opens rather than with the page — it's a line count
  // per purchase and nobody merges on most visits.
  useEffect(() => {
    listPurchaseMergeCandidates().then(setCandidates);
  }, []);

  useEffect(() => {
    if (state?.success) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.success]);

  const byId = useMemo(() => new Map((candidates ?? []).map((c) => [c.id, c])), [candidates]);
  const chosen = selected.map((id) => byId.get(id)!).filter(Boolean);
  // The first tick fixes the company and the supplier; everything that can't
  // legally join them is greyed out rather than left to fail on submit. Books are
  // per company, and an invoice has one supplier — merging two suppliers would
  // move money owed from one to the other with nothing recording it.
  const lockedCompanyId = chosen[0]?.companyId ?? null;
  const lockedContactId = chosen.length > 0 ? (chosen[0].contactId ?? "") : null;

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (candidates ?? []).filter(
      (c) =>
        !q ||
        c.number.toLowerCase().includes(q) ||
        (c.supplier ?? "").toLowerCase().includes(q) ||
        // The cell shows DD-MM-YYYY, so that is what a search typed from the
        // screen has to match — the raw ISO form still matches too.
        c.documentDate.includes(q) ||
        formatDate(c.documentDate).includes(q),
    );
  }, [candidates, search]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      // The survivor has to stay one of the ticked rows.
      if (!next.includes(survivorId)) setSurvivorId(next[0] ?? "");
      else if (!survivorId && next.length > 0) setSurvivorId(next[0]);
      return next;
    });
  }

  const survivor = byId.get(survivorId);
  const losers = chosen.filter((c) => c.id !== survivorId);
  const movingLines = losers.reduce((sum, c) => sum + c.lines, 0);
  const mergedTotal = chosen.reduce((sum, c) => sum + Number(c.grandTotal), 0);
  const mergedShippingPaid = chosen.reduce((sum, c) => sum + c.shippingPaid, 0);

  return (
    <Dialog title="Merge Purchases" onClose={onClose} size="wide">
      <form
        action={action}
        onSubmit={(e) => {
          if (!confirm(`Merge ${chosen.length} purchases into ${survivor?.number}? The other ${losers.length} are deleted and their numbers dropped.`)) {
            e.preventDefault();
          }
        }}
        className="flex flex-col gap-4"
      >
        <input type="hidden" name="documentIds" value={JSON.stringify(selected)} />
        <input type="hidden" name="survivorId" value={survivorId} />

        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by number, supplier or date"
          aria-label="Search purchases"
          className={inputClass}
        />

        <div className="scroll-thin max-h-72 overflow-auto rounded border border-sand">
          {candidates === null ? (
            <p className="p-3 text-sm text-steel">Loading purchases…</p>
          ) : visible.length === 0 ? (
            <p className="p-3 text-sm text-steel">No purchases match.</p>
          ) : (
            <div className="scroll-thin overflow-x-auto">
              <table className="w-full min-w-max border-collapse text-sm">
              <tbody>
                {visible.map((c) => {
                  const checked = selected.includes(c.id);
                  // A purchase paid beyond its shipping has already moved money
                  // out of an account or is holding a cheque; unpicking that is a
                  // different job. Freight alone is fine — the expense was paid on
                  // arrival by design and travels to the survivor with the lines.
                  const settled = c.isPaid || Number(c.paidAmount) > c.shippingPaid;
                  const blocked =
                    !checked &&
                    (settled ||
                      (lockedCompanyId !== null && c.companyId !== lockedCompanyId) ||
                      (lockedContactId !== null && (c.contactId ?? "") !== lockedContactId));
                  return (
                    <tr key={c.id} className={blocked ? "opacity-40" : ""}>
                      <td className="border-b border-sand px-2 py-1.5">
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={blocked}
                            onChange={() => toggle(c.id)}
                            className="h-4 w-4 rounded border-sand"
                          />
                          <span className="text-ink">{c.number}</span>
                        </label>
                      </td>
                      <td className="border-b border-sand px-2 py-1.5 text-steel">{c.supplier ?? "No supplier"}</td>
                      <td className="border-b border-sand px-2 py-1.5 text-steel">{c.company}</td>
                      <td className="border-b border-sand px-2 py-1.5 text-steel">{formatDate(c.documentDate)}</td>
                      <td className="border-b border-sand px-2 py-1.5 text-right tabular-nums text-steel">
                        {c.lines} line{c.lines === 1 ? "" : "s"}
                      </td>
                      <td className="border-b border-sand px-2 py-1.5 text-right tabular-nums text-steel">
                        {settled ? (c.isPaid ? "Paid" : "Part paid") : money(c.grandTotal)}
                      </td>
                      <td className="border-b border-sand px-2 py-1.5 text-right">
                        {/* Radio, not a second checkbox — exactly one number survives. */}
                        <label className="flex items-center justify-end gap-1.5 text-xs text-steel">
                          <input
                            type="radio"
                            name="survivorPick"
                            checked={survivorId === c.id}
                            disabled={!checked}
                            onChange={() => setSurvivorId(c.id)}
                            className="h-4 w-4 border-sand"
                          />
                          keep
                        </label>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              </table>
            </div>
          )}
        </div>

        {chosen.length >= 2 && survivor && (
          <p className="text-sm text-steel">
            {chosen.length} purchases → 1. {movingLines} line{movingLines === 1 ? "" : "s"} move onto{" "}
            <span className="text-ink">{survivor.number}</span>, which becomes{" "}
            <span className="text-ink">{money(mergedTotal - mergedShippingPaid)}</span> owed to{" "}
            {survivor.supplier ?? "no supplier"}
            {mergedShippingPaid > 0
              ? ` — ${money(mergedShippingPaid)} of shipping is already paid as expenses and is not part of the payable.`
              : "."}{" "}
            Stock is unchanged — the movements travel with their lines. The other {losers.length} purchase
            {losers.length === 1 ? "" : "s"} {losers.length === 1 ? "is" : "are"} deleted and {losers.length === 1 ? "its number" : "their numbers"}{" "}
            dropped for good. This cannot be undone.
          </p>
        )}

        {state?.error && <p className={errorTextClass}>{state.error}</p>}

        <button type="submit" disabled={pending || chosen.length < 2 || !survivorId} className={submitClass}>
          {pending ? "Merging…" : `Merge ${chosen.length || ""} Purchases`.trim()}
        </button>
      </form>
    </Dialog>
  );
}
