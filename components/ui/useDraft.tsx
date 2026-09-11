"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { clearDraft, draftSnapshot, noDraft, saveDraft, subscribeDraft, readDraft, resetDraftSnapshot } from "@/lib/draft";

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
//   - Edit callers must supply a version check before offering restoration.
//   - "Discard" dismisses the offer and clears the draft; the next keystroke
//     re-arms protection, because the work being typed now deserves it too.
//
// Clearing on success stays with the caller — it happens inside the save path
// (resetForm, the action's success branch), which only the form knows.

export function useDraft<T>(key: string, opts: {
  // The whole form state, saved on change. Must be serialisable (JSON).
  state: T;
  enabled: boolean;
  // An untouched edit is already stored on the server; only preserve changes.
  skipInitialSave?: boolean;
  canRestore?: (draft: T) => boolean;
  // A draft of a form nobody typed into is noise; return false unless the
  // draft is worth offering back. Defaults to "offer anything".
  hasContent?: (draft: T) => boolean;
  // Write the draft's fields into the form's state. Runs only when the user
  // clicks Restore.
  apply: (draft: T) => void;
}): { offerDraft: boolean; canRestore: boolean; restore: () => void; discard: () => void; download: () => void; storageError: boolean } {
  const { state, enabled, apply } = opts;

  // The draft as it stood when this form opened — lib/draft.ts explains why
  // it's read through a store rather than in an effect or an initialiser.
  const savedDraft = useSyncExternalStore(subscribeDraft, () => draftSnapshot<T>(key), noDraft);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const dismissed = dismissedKey === key;
  const [storageError, setStorageError] = useState(false);
  const lastSaved = useRef<string | null>(null);
  const recovery = useRef<{ key: string; waiting: boolean } | null>(null);
  const offerDraft = enabled && !dismissed && !!savedDraft && (opts.hasContent ? opts.hasContent(savedDraft) : true);
  const canRestore = !!savedDraft && (!opts.canRestore || opts.canRestore(savedDraft));

  function restore() {
    if (!savedDraft || !canRestore) return;
    apply(savedDraft);
    setDismissedKey(key);
  }

  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(savedDraft, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "unsaved-input.json"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // Discard must not immediately re-save: clearing then re-rendering would
  // write the very draft just thrown away back to storage. The next state
  // change — the next keystroke — re-arms protection normally.
  const suppressNextSave = useRef(false);
  function discard() {
    clearDraft(key);
    suppressNextSave.current = true;
    setDismissedKey(key);
  }

  // Saved on every render while enabled. One JSON stringify of a handful of
  // fields is cheap enough not to debounce — the sale form's own comment says
  // a debounce would be code that exists to save microseconds.
  useEffect(() => {
    if (!enabled) return;
    // The hydration frame can still see the server's null snapshot. Read the
    // stored offer here too so that frame cannot overwrite it with blank input.
    if (recovery.current?.key !== key) {
      const original = readDraft<T>(key);
      recovery.current = { key, waiting: original !== null && (!opts.hasContent || opts.hasContent(original)) };
      lastSaved.current = opts.skipInitialSave ? JSON.stringify(state) : null;
    }
    if (!dismissed && recovery.current.waiting) return;
    if (suppressNextSave.current) {
      suppressNextSave.current = false;
      lastSaved.current = JSON.stringify(state);
      return;
    }
    const serialized = JSON.stringify(state);
    if (lastSaved.current === serialized) return;
    const saved = saveDraft(key, state);
    if (saved) lastSaved.current = serialized;
    queueMicrotask(() => setStorageError(!saved));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, state, dismissed, key]);

  useEffect(() => () => resetDraftSnapshot(key), [key]);

  return { offerDraft, canRestore, restore, discard, download, storageError };
}

// The banner every draft-offering form renders, so the offer reads and behaves
// the same everywhere it appears.
export function DraftBanner({
  noun,
  onRestore,
  onDiscard,
  canRestore = true,
  onDownload,
}: {
  noun: string;
  onRestore: () => void;
  onDiscard: () => void;
  canRestore?: boolean;
  onDownload?: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-brass-600 bg-brass-100 px-3 py-2 text-sm text-ink">
      <span>{canRestore ? `You have an unsaved ${noun} from earlier. Restore or discard it before continuing.` : "This record changed since your unsaved edit. Download your previous input to review it against the latest record."}</span>
      <span className="flex items-center gap-3">
        {canRestore && <button type="button" onClick={onRestore} className="font-semibold text-navy-800 hover:underline">
          Restore it
        </button>}
        {onDownload && <button type="button" onClick={onDownload} className="text-navy-800 hover:underline">Download a copy</button>}
        <button type="button" onClick={onDiscard} className="text-steel hover:underline">
          Discard
        </button>
      </span>
    </div>
  );
}
