"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/ui/Dialog";
import { GO_TO, SHORTCUT_GROUPS } from "@/lib/shortcuts";
import { setZoom } from "@/lib/actions/preferences";
import { DEFAULT_SCALE, fontSizeForScale, zoomIn, zoomOut } from "@/lib/preference-constants";

// Every key the app answers to that isn't owned by one component, registered
// once here rather than wired into each of the ~30 forms:
//
//   Ctrl/Cmd + Enter        submit the form the focus is in — or the open
//                           dialog's, when the focus is in its body
//   Ctrl/Cmd + I            jump to the first line item (every document form)
//   Ctrl/Cmd + D            jump to the discount field (sale, purchase, quotation)
//   Ctrl/Cmd + T            jump to the tax field (sale, purchase, quotation)
//   Ctrl/Cmd + S            jump to the shipping field (sale, purchase, quotation)
//   Alt + I/D/T/S           the same jumps inside a popup (the purchase popup)
//   Ctrl/Cmd + Backspace    empty the focused field (Delete does the same)
//   Ctrl Alt + / Ctrl Alt - zoom in and out (the same ladder as Settings)
//   g then <key>            go to a page (lib/shortcuts.ts)
//   ?                       show the shortcut sheet
//
// Batch popups have no <form> of their own (their Save is an ordinary button), so
// BatchAddDialog handles Ctrl+Enter itself — this only covers real forms. Lists
// own their own arrow keys (DataTable) and grids own theirs (grid-keys.ts),
// which is why neither appears here.

// React tracks the value of a controlled input internally, so assigning
// `el.value = ""` updates the DOM and then gets overwritten on the next render.
// Going through the prototype's setter and firing an input event is what makes
// React see the change as if it had been typed.
function clearField(el: HTMLInputElement | HTMLTextAreaElement) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, "");
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

// A bare letter must never be a shortcut while someone is typing a product name.
function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

// How long `g` stays armed. Long enough to be a deliberate two-key press, short
// enough that a `g` typed and abandoned doesn't hijack the next key pressed.
const SEQUENCE_MS = 1200;

// The field jumps — Ctrl/Cmd+I/D/T/S on a page, Alt+I/D/T/S inside a popup —
// move focus to whichever field a form marked with the matching data-shortcut
// attribute. The sale, purchase and quotation forms mark all four; the
// transfer, inter-company and stock-adjustment forms mark only the first line
// item, since they have no discount, tax or shipping fields
// (StockTransferForm.tsx, InterCompanyForm.tsx, StockAdjustmentForm.tsx).
// Everywhere else the keys stay the browser's own (italic, bookmark, new tab,
// save page).
const SHORTCUT_FIELD_KEYS = ["i", "d", "t", "s"];

// Fired by anything that wants to show the sheet without a keypress.
export const SHORTCUTS_EVENT = "erp:shortcuts";
export const openShortcuts = () => window.dispatchEvent(new Event(SHORTCUTS_EVENT));

// Fired whenever the zoom changes by keyboard, so the Settings card — which
// owns the % label and its buttons' disabled states — can follow a size it
// didn't set itself.
export const ZOOM_EVENT = "erp:zoom";

// The current zoom, read off the document. The root layout and the Settings
// page both write the scale into <html>'s inline font size, and 100% is
// represented by no style at all — so the number is parseable or it's 100.
function currentScale(): number {
  const m = /^(\d+(?:\.\d+)?)%$/.exec(document.documentElement.style.fontSize);
  return m ? Number(m[1]) : DEFAULT_SCALE;
}

// Alt+N — "one more of whatever this page makes". Ctrl+N is Chrome's own (new
// window) and never reaches a page, and Alt is what lets it work from inside a
// text box, which is where the cursor always is in a half-typed purchase.
export const NEW_ENTRY_EVENT = "erp:new";

// What each screen does about Alt+N, registered by the screen itself rather than
// guessed at from here: a list opens its add popup, and a form already inside a
// popup saves and starts the next one. `inDialog` is which of the two this is —
// with a popup on screen the list behind it must stay quiet, or Alt+N would open
// a second one on top of the first.
export function useNewEntry(handler: () => void, inDialog = false) {
  useEffect(() => {
    function onNew() {
      if (!!document.querySelector('[role="dialog"]') !== inDialog) return;
      handler();
    }
    window.addEventListener(NEW_ENTRY_EVENT, onNew);
    return () => window.removeEventListener(NEW_ENTRY_EVENT, onNew);
    // No dep array: the handler closes over current state, and re-subscribing a
    // single listener costs nothing next to reading a stale `open`.
  });
}

export function KeyboardShortcuts() {
  const router = useRouter();
  const [helpOpen, setHelpOpen] = useState(false);
  // Whether `g` is armed. A ref, not state: it changes on a keypress that must
  // not re-render the whole dashboard.
  const pendingGo = useRef<number | null>(null);

  useEffect(() => {
    // Zoom lands the same way the Settings buttons do it (AppearanceSettings.tsx):
    // applied to the document first for instant feedback, then saved. No refresh
    // afterwards — setZoom revalidates the layout, so the next fetch of any route
    // is rendered at the new size, and the document is already right here.
    function applyZoom(next: number) {
      document.documentElement.style.fontSize = fontSizeForScale(next);
      window.dispatchEvent(new CustomEvent<number>(ZOOM_EVENT, { detail: next }));
      void setZoom(next);
    }

    function onKeyDown(e: KeyboardEvent) {
      // Up/Down in a number field steps its value. In a grid that means arrowing
      // between rows quietly rewrites a price or a quantity, and nothing here
      // wants that — the keys stay a way to move, never a way to edit. No
      // return: the grid's own arrow handling still runs, only the step is off.
      if ((e.key === "ArrowUp" || e.key === "ArrowDown") && e.target instanceof HTMLInputElement && e.target.type === "number") {
        e.preventDefault();
      }

      // Alt+N: whoever is listening decides what "new" means here. Fires from
      // inside a field too — the purchase popup's Next Purchase is the point.
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        window.dispatchEvent(new Event(NEW_ENTRY_EVENT));
        return;
      }

      // Ctrl/Alt + plus and Ctrl/Alt + minus are the zoom — the same ladder the
      // Settings page uses, applied to the document and saved to the account.
      // The plus row needs Shift to produce "+", so its unshifted "=" is
      // matched too; the numpad's keys already arrive as "+" and "-".
      if (e.ctrlKey && e.altKey && !e.metaKey) {
        if (e.key === "+" || e.key === "=") {
          e.preventDefault();
          applyZoom(zoomIn(currentScale()));
          return;
        }
        if (e.key === "-") {
          e.preventDefault();
          applyZoom(zoomOut(currentScale()));
          return;
        }
      }

      // --- Modified keys: work everywhere, including inside a field ----------
      const el = e.target;

      // The field jumps. The browser has its own Ctrl+D/T/S (bookmark, new
      // tab, save page), so the default is stopped only when the form
      // actually marked a field for this key. On a page they are
      // Ctrl/Cmd+I/D/T/S; inside a popup they are Alt+I/D/T/S — the purchase
      // popup's other shortcut is Alt+N, so its modifier language is Alt and
      // the browser's Ctrl keys stay untouched there.
      const fieldKey = e.key.toLowerCase();
      if (SHORTCUT_FIELD_KEYS.includes(fieldKey)) {
        const inDialog = el instanceof Element && !!el.closest('[role="dialog"]');
        if (inDialog ? e.altKey && !e.ctrlKey && !e.metaKey : e.ctrlKey || e.metaKey) {
          const form = el instanceof Element ? el.closest("form") : null;
          const target = form?.querySelector<HTMLElement>(`[data-shortcut="${fieldKey}"]`);
          if (target) {
            e.preventDefault();
            target.focus();
            // select() also focuses, and highlights the current value — a jump
            // to a "5%" discount is ready to be typed over, not appended to.
            if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) target.select();
          }
          return;
        }
        // Unarmed, the key keeps its other meanings — the bare-key section below
        // still consumes `g then i` / `g then s`, and the browser's own
        // Ctrl+D/T/S (bookmark, new tab, save page) is untouched where no form
        // marked a field for it.
      }

      if (e.ctrlKey || e.metaKey) {
        if (e.key === "Enter") {
          const target = el instanceof Element ? el : null;
          let form = target?.closest("form") ?? null;
          // A dialog whose submit lives out of reach of the focus — a form
          // that wraps only the footer (the Convert to Invoice popup), or a
          // Save/Apply button that calls a function (the batch-edit grids, the
          // date-range filter) — still gets Ctrl+Enter from anywhere in its
          // body when it marks that element data-dialog-submit. An unmarked
          // form (a delete form, a paid sending path) is never submitted from
          // outside itself.
          // The target itself excluded: focus already on the marked button
          // (plain Enter activates it natively) is not re-clicked here.
          if (!form && target && !target.matches("[data-dialog-submit]")) {
            const submit = target.closest('[role="dialog"]')?.querySelector<HTMLElement>(
              "form[data-dialog-submit], button[data-dialog-submit]",
            );
            if (submit instanceof HTMLFormElement) form = submit;
            else if (submit instanceof HTMLButtonElement) {
              e.preventDefault();
              submit.click();
              return;
            }
          }
          if (form) {
            e.preventDefault();
            // requestSubmit, not submit(): it runs validation and fires the
            // submit event, which is what a server action is listening for.
            form.requestSubmit();
          }
          return;
        }

        if (e.key !== "Backspace" && e.key !== "Delete") return;

        if (el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && el.type !== "checkbox" && el.type !== "radio")) {
          e.preventDefault();
          clearField(el);
        } else if (el instanceof HTMLSelectElement && Array.from(el.options).some((o) => o.value === "")) {
          // Only when the select actually offers a blank ("— None —") option;
          // clearing a required dropdown to nothing would just fail validation.
          e.preventDefault();
          el.value = "";
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }
        return;
      }

      // --- Bare keys: only when the focus isn't in something you type into ---
      if (isTyping(e.target)) return;
      // A dialog is a modal — navigating out from under one would abandon
      // whatever is half-typed in it without so much as a question. Asked of the
      // DOM rather than through an export from Dialog, because "is a modal on
      // screen" is a fact the DOM already holds.
      if (document.querySelector('[role="dialog"]')) return;

      if (e.key === "?") {
        e.preventDefault();
        setHelpOpen(true);
        return;
      }

      if (e.key === "Escape" && pendingGo.current !== null) {
        window.clearTimeout(pendingGo.current);
        pendingGo.current = null;
        return;
      }

      // Second half of a `g` sequence.
      if (pendingGo.current !== null) {
        window.clearTimeout(pendingGo.current);
        pendingGo.current = null;
        const destination = GO_TO[e.key.toLowerCase()];
        if (destination) {
          e.preventDefault();
          router.push(destination.href);
        }
        return;
      }

      if (e.key.toLowerCase() === "g") {
        e.preventDefault();
        // Disarms itself, so `g` pressed by accident doesn't swallow the letter
        // typed a minute later.
        pendingGo.current = window.setTimeout(() => {
          pendingGo.current = null;
        }, SEQUENCE_MS);
      }
    }

    // The Topbar's "?" button opens the same sheet. An event rather than lifted
    // state, because the sheet is the only thing the two share and threading a
    // setter through the layout to reach it would be more wiring than it's worth.
    const open = () => setHelpOpen(true);

    document.addEventListener("keydown", onKeyDown);
    window.addEventListener(SHORTCUTS_EVENT, open);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener(SHORTCUTS_EVENT, open);
      if (pendingGo.current !== null) window.clearTimeout(pendingGo.current);
    };
  }, [router]);

  if (!helpOpen) return null;

  return (
    <Dialog title="Keyboard shortcuts" size="wide" onClose={() => setHelpOpen(false)}>
      <div className="grid grid-cols-1 gap-x-10 gap-y-6 md:grid-cols-2">
        {SHORTCUT_GROUPS.map((group) => (
          <section key={group.title}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-brass-600">{group.title}</h3>
            <dl className="flex flex-col gap-1">
              {group.shortcuts.map((s) => (
                <div key={s.keys + s.label} className="flex items-baseline justify-between gap-6 text-sm">
                  <dt className="text-ink">{s.label}</dt>
                  <dd className="flex shrink-0 gap-1">
                    {s.keys.split(" ").map((key, i) =>
                      key === "then" || key === "/" ? (
                        <span key={i} className="px-0.5 text-xs text-steel">
                          {key}
                        </span>
                      ) : (
                        <kbd key={i} className="rounded border border-sand bg-ivory px-1.5 py-0.5 font-mono text-xs text-navy-800">
                          {key}
                        </kbd>
                      ),
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
