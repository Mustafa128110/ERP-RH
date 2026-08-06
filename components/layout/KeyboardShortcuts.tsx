"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/ui/Dialog";
import { GO_TO, SHORTCUT_GROUPS } from "@/lib/shortcuts";

// Every key the app answers to that isn't owned by one component, registered
// once here rather than wired into each of the ~30 forms:
//
//   Ctrl/Cmd + Enter        submit the form the focus is in
//   Ctrl/Cmd + Backspace    empty the focused field (Delete does the same)
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

// Fired by anything that wants to show the sheet without a keypress.
export const SHORTCUTS_EVENT = "erp:shortcuts";
export const openShortcuts = () => window.dispatchEvent(new Event(SHORTCUTS_EVENT));

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

      // --- Modified keys: work everywhere, including inside a field ----------
      if (e.ctrlKey || e.metaKey) {
        const el = e.target;

        if (e.key === "Enter") {
          const form = el instanceof Element ? el.closest("form") : null;
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
