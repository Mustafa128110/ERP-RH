"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { listContactMergeCandidates, mergeContacts, type ContactMergeCandidate } from "@/lib/actions/contacts";
import { Dialog } from "@/components/ui/Dialog";
import { inputClass, labelClass, labelTextClass, submitClass, errorTextClass } from "@/components/ui/form-styles";

// Folding duplicate contacts into one. The list is every contact in scope; tick
// the ones that are the same person, say which row survives, and choose the name
// it keeps — those two are the whole decision.
//
// A merge moves history rather than copying it: the duplicates' document lines
// and cheques point to the survivor, so the ledger, sales, purchases and
// WhatsApp all come out combined under one contact.
export function MergeContactsDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [candidates, setCandidates] = useState<ContactMergeCandidate[] | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [survivorId, setSurvivorId] = useState("");

  const [state, action, pending] = useActionState(mergeContacts, undefined);

  useEffect(() => {
    listContactMergeCandidates().then(setCandidates);
  }, []);

  useEffect(() => {
    if (state?.success) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.success]);

  const byId = useMemo(() => new Map((candidates ?? []).map((c) => [c.id, c])), [candidates]);
  const chosen = selected.map((id) => byId.get(id)!).filter(Boolean);
  const lockedCompanyId = chosen[0]?.companyId ?? null;

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (candidates ?? []).filter((c) =>
      !q || c.displayName.toLowerCase().includes(q) || c.phone?.toLowerCase().includes(q) || c.email?.toLowerCase().includes(q)
    );
  }, [candidates, search]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      if (!next.includes(survivorId)) setSurvivorId(next[0] ?? "");
      else if (!survivorId && next.length > 0) setSurvivorId(next[0]);
      return next;
    });
  }

  const survivor = byId.get(survivorId);
  const movingDocs = chosen.filter((c) => c.id !== survivorId).reduce((sum, c) => sum + c.documents, 0);
  const movingCheques = chosen.filter((c) => c.id !== survivorId).reduce((sum, c) => sum + c.cheques, 0);

  return (
    <Dialog title="Merge Contacts" onClose={onClose} size="wide">
      <form
        action={action}
        onSubmit={(e) => {
          if (!confirm(`Merge ${chosen.length} contacts into one? The other ${chosen.length - 1} are deleted and their history moves to the survivor.`)) {
            e.preventDefault();
          }
        }}
        className="flex flex-col gap-4"
      >
        <input type="hidden" name="contactIds" value={JSON.stringify(selected)} />
        <input type="hidden" name="survivorId" value={survivorId} />

        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, phone or email"
          aria-label="Search contacts"
          className={inputClass}
        />

        <div className="scroll-thin max-h-72 overflow-auto rounded border border-sand">
          {candidates === null ? (
            <p className="p-3 text-sm text-steel">Loading contacts…</p>
          ) : visible.length === 0 ? (
            <p className="p-3 text-sm text-steel">No contacts match.</p>
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
                            <span className="text-ink">{c.displayName}</span>
                          </label>
                        </td>
                        <td className="border-b border-sand px-2 py-1.5 text-steel">{c.company}</td>
                        <td className="border-b border-sand px-2 py-1.5 text-steel">{c.phone ?? "—"}</td>
                        <td className="border-b border-sand px-2 py-1.5 text-steel">{c.email ?? "—"}</td>
                        <td className="border-b border-sand px-2 py-1.5 text-right tabular-nums text-steel">
                          {c.documents} doc{c.documents === 1 ? "" : "s"}
                        </td>
                        <td className="border-b border-sand px-2 py-1.5 text-right">
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
            <label className={`${labelClass} w-64`}>
              <span className={labelTextClass}>Keep name</span>
              <select name="displayName" defaultValue={survivor.displayName} key={`name-${survivorId}`} className={inputClass}>
                {chosen.map((c) => (
                  <option key={c.id} value={c.displayName}>
                    {c.displayName}
                  </option>
                ))}
              </select>
            </label>

            <p className="text-sm text-steel">
              {chosen.length} contacts → 1. {movingDocs} document{movingDocs === 1 ? "" : "s"} and {movingCheques} cheque{movingCheques === 1 ? "" : "s"}{" "}
              move to <span className="text-ink">{survivor.displayName}</span>; their sales, purchases, ledger and WhatsApp all combine under it.{" "}
              The other {chosen.length - 1} contact{chosen.length - 1 === 1 ? " is" : "s are"} deleted. This cannot be undone.
            </p>
          </>
        )}

        {state?.error && <p className={errorTextClass}>{state.error}</p>}

        <button type="submit" disabled={pending || chosen.length < 2 || !survivorId} className={submitClass}>
          {pending ? "Merging…" : `Merge ${chosen.length || ""} Contacts`.trim()}
        </button>
      </form>
    </Dialog>
  );
}
