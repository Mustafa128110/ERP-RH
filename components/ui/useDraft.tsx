"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { clearDraft, draftSnapshot, noDraft, saveDraft, subscribeDraft } from "@/lib/draft";

// Draft protection for any form someone spends real time typing into, in one
// place. SaleForm and StockPurchaseForm each carried a copy of this — the same
// store read, the same dismissed flag, the same offer/restore/discard buttons,
// the same save-on-change effect — differing only in the key, the shape of the
// draft, and which setters restore() touches. Extracting it means a form gets
// the whole guarantee (a crash, a closed tab, an offline blip costs nothing)
// by declaring its draft, instead of re-deriving the plumbing.
//
// The rules the sale form learned the hard way, preserved here:
//
//   - The draft is OFFERED, never applied. Silently repopulating a form is
//     worse than losing it — the shop would post a sale it believed it had
//     typed fresh. Restore is a click.
//   - New records only. An edit has a saved record behind it, and quietly
//     restoring a stale copy over one is how someone else's changes disappear.
//   - "Discard" dismisses the offer and clears the draft; the next keystroke
//     re-arms protection, because the work being typed now deserves it too.
//
// Clearing on success stays with the caller — it happens inside the save path
// (resetForm, the action's success branch), which only the form knows.

export function useDraft<T>(key: string, opts: {
  // The whole form state, saved on change. Must be serialisable (JSON).
  state: T;
  // False on an edit — a draft never overwrites a saved record.
  enabled: boolean;
  // A draft of a form nobody typed into is noise; return false unless the
  // draft is worth offering back. Defaults to "offer anything".
  hasContent?: (draft: T) => boolean;
  // Write the draft's fields into the form's state. Runs only when the user
  // clicks Restore.
  apply: (draft: T) => void;
}): { offerDraft: boolean; restore: () => void; discard: () => void } {
  const { state, enabled, apply } = opts;

  // The draft as it stood when this form opened — lib/draft.ts explains why
  // it's read through a store rather than in an effect or an initialiser.
  const savedDraft = useSyncExternalStore(subscribeDraft, () => draftSnapshot<T>(key), noDraft);
  const [dismissed, setDismissed] = useState(false);
  const offerDraft = enabled && !dismissed && !!savedDraft && (opts.hasContent ? opts.hasContent(savedDraft) : true);

  function restore() {
    if (!savedDraft) return;
    apply(savedDraft);
    setDismissed(true);
  }

  // Discard must not immediately re-save: clearing then re-rendering would
  // write the very draft just thrown away back to storage. The next state
  // change — the next keystroke — re-arms protection normally.
  const suppressNextSave = useRef(false);
  function discard() {
    clearDraft(key);
    suppressNextSave.current = true;
    setDismissed(true);
  }

  // Saved on every render while enabled. One JSON stringify of a handful of
  // fields is cheap enough not to debounce — the sale form's own comment says
  // a debounce would be code that exists to save microseconds.
  useEffect(() => {
    if (!enabled) return;
    if (suppressNextSave.current) {
      suppressNextSave.current = false;
      return;
    }
    saveDraft(key, state);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, state]);

  return { offerDraft, restore, discard };
}

// The banner every draft-offering form renders, so the offer reads and behaves
// the same everywhere it appears.
export function DraftBanner({
  noun,
  onRestore,
  onDiscard,
}: {
  noun: string;
  onRestore: () => void;
  onDiscard: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-brass-600 bg-brass-100 px-3 py-2 text-sm text-ink">
      <span>You have an unsaved {noun} from earlier.</span>
      <span className="flex items-center gap-3">
        <button type="button" onClick={onRestore} className="font-semibold text-navy-800 hover:underline">
          Restore it
        </button>
        <button type="button" onClick={onDiscard} className="text-steel hover:underline">
          Discard
        </button>
      </span>
    </div>
  );
}
