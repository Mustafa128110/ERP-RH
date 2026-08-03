"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { listMergeCandidates, mergeProducts, type MergeCandidate } from "@/lib/actions/products";
import { Dialog } from "@/components/ui/Dialog";
import { inputClass, labelClass, labelTextClass, submitClass, errorTextClass } from "@/components/ui/form-styles";

// Folding duplicate products into one. The list is every product in scope; tick
// the ones that are the same thing, say which row survives, and choose the name
// and SKU it keeps — those three are the whole decision.
//
// A merge moves history rather than copying it: the duplicates' document lines
// become the survivor's, and inventory_transactions hang off those lines, so
// stock, valuation and the rate list all come out combined under one product.
export function MergeProductsDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [candidates, setCandidates] = useState<MergeCandidate[] | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [survivorId, setSurvivorId] = useState("");

  const [state, action, pending] = useActionState(mergeProducts, undefined);

  // Loaded when the dialog opens rather than with the page — the counts are two
  // subqueries per product and nobody merges on most visits.
  useEffect(() => {
    listMergeCandidates().then(setCandidates);
  }, []);

  useEffect(() => {
    if (state?.success) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.success]);

  const byId = useMemo(() => new Map((candidates ?? []).map((c) => [c.id, c])), [candidates]);
  const chosen = selected.map((id) => byId.get(id)!).filter(Boolean);
  // Catalogs are per company; the first tick fixes which company this merge is
  // in, and the rest of that company's rows are the only ones still selectable.
  const lockedCompanyId = chosen[0]?.companyId ?? null;

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (candidates ?? []).filter((c) => !q || c.name.toLowerCase().includes(q) || c.sku.toLowerCase().includes(q));
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
  const movingLines = chosen.filter((c) => c.id !== survivorId).reduce((sum, c) => sum + c.lines, 0);
  const movingMovements = chosen.filter((c) => c.id !== survivorId).reduce((sum, c) => sum + c.movements, 0);

  return (
    <Dialog title="Merge Products" onClose={onClose} size="wide">
      <form
        action={action}
        onSubmit={(e) => {
          if (!confirm(`Merge ${chosen.length} products into one? The other ${chosen.length - 1} are deleted and their history moves to the survivor.`)) {
            e.preventDefault();
          }
        }}
        className="flex flex-col gap-4"
      >
        <input type="hidden" name="itemIds" value={JSON.stringify(selected)} />
        <input type="hidden" name="survivorId" value={survivorId} />

        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or SKU"
          aria-label="Search products"
          className={inputClass}
        />

        <div className="scroll-thin max-h-72 overflow-auto rounded border border-sand">
          {candidates === null ? (
            <p className="p-3 text-sm text-steel">Loading products…</p>
          ) : visible.length === 0 ? (
            <p className="p-3 text-sm text-steel">No products match.</p>
          ) : (
            <div className="scroll-thin overflow-x-auto">
              <table className="w-full min-w-max border-collapse text-sm">
              <tbody>
                {visible.map((c) => {
                  const checked = selected.includes(c.id);
                  const blocked = !checked && lockedCompanyId !== null && c.companyId !== lockedCompanyId;
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
                          <span className="text-ink">{c.name}</span>
                        </label>
                      </td>
                      <td className="border-b border-sand px-2 py-1.5 text-steel">{c.sku}</td>
                      <td className="border-b border-sand px-2 py-1.5 text-steel">{c.company}</td>
                      <td className="border-b border-sand px-2 py-1.5 text-right tabular-nums text-steel">
                        {c.lines} line{c.lines === 1 ? "" : "s"}
                      </td>
                      <td className="border-b border-sand px-2 py-1.5 text-right">
                        {/* Radio, not a second checkbox — exactly one row survives. */}
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
          <>
            <div className="flex flex-wrap gap-3">
              <label className={`${labelClass} w-64`}>
                <span className={labelTextClass}>Keep name</span>
                <select name="name" defaultValue={survivor.name} key={`name-${survivorId}`} className={inputClass}>
                  {chosen.map((c) => (
                    <option key={c.id} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className={`${labelClass} w-40`}>
                <span className={labelTextClass}>Keep SKU</span>
                <select name="sku" defaultValue={survivor.sku} key={`sku-${survivorId}`} className={inputClass}>
                  {chosen.map((c) => (
                    <option key={c.id} value={c.sku}>
                      {c.sku}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <p className="text-sm text-steel">
              {chosen.length} products → 1. {movingLines} document line{movingLines === 1 ? "" : "s"} and {movingMovements} stock movement
              {movingMovements === 1 ? "" : "s"} move to <span className="text-ink">{survivor.name}</span>; their sales, purchases, stock and
              valuation combine under it. The other {chosen.length - 1} product{chosen.length - 1 === 1 ? " is" : "s are"} deleted. This cannot be
              undone.
            </p>
          </>
        )}

        {state?.error && <p className={errorTextClass}>{state.error}</p>}

        <button type="submit" disabled={pending || chosen.length < 2 || !survivorId} className={submitClass}>
          {pending ? "Merging…" : `Merge ${chosen.length || ""} Products`.trim()}
        </button>
      </form>
    </Dialog>
  );
}
