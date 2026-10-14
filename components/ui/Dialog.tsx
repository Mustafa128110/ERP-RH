"use client";

import { useEffect, useRef } from "react";

// Sizing rule: fit the content, cap at the viewport. The dialog is never taller
// or wider than it needs to be — a three-field form gets a three-field box — but
// it also never grows past the screen, at which point the body scrolls instead.
// The backdrop stays visible on all sides so it reads as a layer, not a page.
//
//   form — a stacked column of inputs. These have no intrinsic width (every
//          field is block-level), so the width is fixed and only the height
//          fits the content.
//   wide — batch tables and line-item editors. The table inside is `min-w-max`,
//          so it does have an intrinsic width: `w-fit` lets a three-column
//          batch hug its columns instead of sprawling across 1600px, while a
//          twelve-column one still gets the room it needs.
//
// Below sm every size is the same thing — the whole screen. A centred card with
// a margin is right on a desktop and wrong on a 360px phone, where the margin is
// screen you cannot afford and the "layer" reading is lost anyway once the card
// fills most of the viewport. `max-sm:` overrides come first in each string so
// the desktop rule still wins above the breakpoint.
const SIZE = {
  form: "max-sm:w-full max-sm:max-w-none w-full max-w-[min(96vw,640px)]",
  wide: "max-sm:w-full max-sm:min-w-0 max-sm:max-w-none w-fit min-w-[min(92vw,560px)] max-w-[min(96vw,1600px)]",
  // Roomier fixed width for the line-item editors (sales/stock purchase), where
  // the item column needs to breathe.
  xwide: "max-sm:w-full w-[min(98vw,1440px)]",
  full: "max-sm:w-full w-[min(98vw,1600px)]",
} as const;

// Dialogs nest — a quick-add popup opens on top of the form that spawned it — so
// two behaviours have to be shared across all open dialogs rather than handled
// per-instance:
//
//   * Body scroll. Each dialog freezes the page behind it, but a naive
//     lock-on-mount / unlock-on-unmount unfreezes the page when the *inner*
//     dialog closes while the outer is still open. This stack unlocks only when
//     the last dialog goes.
//   * Escape. Every dialog listens on `window`, so without coordination one Esc
//     closes the whole stack at once. Only the dialog on top of the stack acts.
const dialogStack: (() => void)[] = [];

function pushDialog(close: () => void) {
  if (dialogStack.length === 0) {
    document.body.style.overflow = "hidden";
    const main = document.querySelector("main");
    if (main) {
      main.dataset.prevOverflow = main.style.overflow;
      main.style.overflow = "hidden";
    }
  }
  dialogStack.push(close);
  return () => {
    const i = dialogStack.indexOf(close);
    if (i >= 0) dialogStack.splice(i, 1);
    if (dialogStack.length === 0) {
      document.body.style.overflow = "";
      const main = document.querySelector("main");
      if (main) {
        main.style.overflow = main.dataset.prevOverflow || "";
        delete main.dataset.prevOverflow;
      }
    }
  };
}

export function Dialog({
  onClose,
  title,
  children,
  size = "form",
  footer,
  hidden,
}: {
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  size?: keyof typeof SIZE;
  // Pinned below the scroll area, so Save/Cancel stay reachable without
  // scrolling to the bottom of a long form.
  footer?: React.ReactNode;
  // Out of the way, but still mounted — display:none rather than unmounted.
  //
  // A list screen hides its edit dialog the moment Save is pressed, so the row
  // behind it can show the change while the write is still in the air
  // (lib/use-optimistic-records). If the server then has something to say —
  // "that name is taken", or a request to confirm releasing settled money — the
  // dialog comes back, and it has to come back with everything still in it.
  // Unmounting would drop the typed values, the action's result, and the Confirm
  // state that goes with it; keeping the DOM alive behind display:none loses
  // nothing, which is the whole reason this isn't just an early close.
  hidden?: boolean;
}) {
  // Kept in a ref so the registration effect can run once (empty deps) without
  // going stale when the parent passes a new onClose each render.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const close = () => onCloseRef.current();
    function onKey(e: KeyboardEvent) {
      // Only the dialog on top of the stack responds, so Esc peels one layer at
      // a time instead of collapsing a nested popup and its parent together.
      if (e.key === "Escape" && dialogStack[dialogStack.length - 1] === close) {
        e.preventDefault();
        close();
      }
    }
    window.addEventListener("keydown", onKey);
    const pop = pushDialog(close);
    return () => {
      window.removeEventListener("keydown", onKey);
      pop();
    };
  }, []);

  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = backdropRef.current;
    if (!el) return;

    function onWheel(e: WheelEvent) {
      let cur = e.target as HTMLElement | null;
      let scrollable: HTMLElement | null = null;

      while (cur && cur !== el) {
        const style = window.getComputedStyle(cur);
        const canScrollY = (style.overflowY === "auto" || style.overflowY === "scroll") && cur.scrollHeight > cur.clientHeight;
        const canScrollX = (style.overflowX === "auto" || style.overflowX === "scroll") && cur.scrollWidth > cur.clientWidth;
        if (canScrollY || canScrollX) {
          scrollable = cur;
          break;
        }
        cur = cur.parentElement;
      }

      if (!scrollable) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      if (Math.abs(e.deltaY) >= Math.abs(e.deltaX)) {
        const maxScrollY = scrollable.scrollHeight - scrollable.clientHeight;
        const nextY = scrollable.scrollTop + e.deltaY;
        if (e.deltaY > 0 && nextY >= maxScrollY) {
          scrollable.scrollTop = maxScrollY;
          e.preventDefault();
          e.stopPropagation();
        } else if (e.deltaY < 0 && nextY <= 0) {
          scrollable.scrollTop = 0;
          e.preventDefault();
          e.stopPropagation();
        } else {
          e.stopPropagation();
        }
      } else {
        const maxScrollX = scrollable.scrollWidth - scrollable.clientWidth;
        const nextX = scrollable.scrollLeft + e.deltaX;
        if (e.deltaX > 0 && nextX >= maxScrollX) {
          scrollable.scrollLeft = maxScrollX;
          e.preventDefault();
          e.stopPropagation();
        } else if (e.deltaX < 0 && nextX <= 0) {
          scrollable.scrollLeft = 0;
          e.preventDefault();
          e.stopPropagation();
        } else {
          e.stopPropagation();
        }
      }
    }

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
    };
  }, []);

  return (
    <div
      ref={backdropRef}
      className={`fixed inset-0 z-50 flex items-stretch justify-center overscroll-contain bg-scrim/50 backdrop-blur-sm sm:items-center sm:p-6 ${
        hidden ? "hidden" : ""
      }`}
      onClick={onClose}
      role="presentation"
    >
      {/* No `h-full` on purpose: height comes from the content and only stops
          at 92vh. With h-full a two-field form rendered as a full-height box of
          mostly whitespace. */}
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`flex max-h-[100dvh] ${SIZE[size]} flex-col overscroll-contain overflow-hidden border-sand bg-white shadow-xl max-sm:h-[100dvh] max-sm:pb-[env(safe-area-inset-bottom)] sm:max-h-[92vh] sm:rounded-lg sm:border`}
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-sand px-4 py-3 sm:px-5">
          <h2 className="min-w-0 truncate font-display text-base font-semibold text-navy-800">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-11 w-11 items-center justify-center rounded-md text-steel hover:bg-ivory hover:text-navy-800"
          >
            ✕
          </button>
        </header>

        {/* flex-auto, not flex-1: flex-1 sets flex-basis to 0, which collapses
            this section in a container whose height comes from its content.
            flex-auto keeps content as the basis and still lets the section
            shrink once the 92vh cap bites — and min-h-0 is what permits that
            shrink, since a flex child otherwise refuses to go below its content
            and the dialog grows past the cap instead of scrolling. */}
        <div className="scroll-thin min-h-0 flex-auto overflow-y-auto overscroll-contain p-4 sm:p-5">{children}</div>

        {footer && <footer className="shrink-0 border-t border-sand px-4 py-3 sm:px-5">{footer}</footer>}
      </div>
    </div>
  );
}
