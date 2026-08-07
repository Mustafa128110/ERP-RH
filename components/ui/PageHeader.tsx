"use client";

import { useEffect, useState } from "react";

// The title / record-count / action-buttons strip every list page opens with.
// It was copy-pasted identically into fifteen managers; the only things that
// ever differed were the words and which buttons went on the right.
//
// Stacks below sm. A title plus four action buttons on one line is what pushes a
// 360px screen into horizontal scrolling, and the actions are what get cut off —
// so they drop under the title and wrap among themselves instead.
//
// It also gets out of the way. Reading a list is a scrolling job, and the
// heading has nothing to say after the first second of it, so scrolling down
// folds it away and the rows take the height it was using; scrolling back up
// brings it straight back.
//
// The scroll is listened for in the CAPTURE phase on the document, because
// there is no one scroll container to attach to: on a list screen the rows
// scroll inside DataTable's own overflow div, while on a form or a report the
// page's <main> is what moves. Scroll events don't bubble, but they do capture,
// so this catches either without every page having to say which it is.
const HIDE_AFTER = 24; // px scrolled before the header is worth hiding
const JITTER = 4; // px of wobble to ignore, so a trackpad doesn't flicker it

export function PageHeader({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}) {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let last = 0;

    function onScroll(e: Event) {
      const target = e.target;
      const top =
        target === document || target === document.documentElement || target === document.body
          ? window.scrollY
          : target instanceof HTMLElement
            ? target.scrollTop
            : 0;

      // Near the top there is nothing to gain by hiding, and reappearing only
      // once you scroll *up* from row three would feel stuck.
      if (top <= HIDE_AFTER) setHidden(false);
      else if (top > last + JITTER) setHidden(true);
      else if (top < last - JITTER) setHidden(false);

      last = top;
    }

    document.addEventListener("scroll", onScroll, true);
    return () => document.removeEventListener("scroll", onScroll, true);
  }, []);

  return (
    // The 0fr/1fr grid row is what makes the collapse animate: height:0 and
    // height:auto have nothing to transition between, but two grid tracks do.
    // motion-reduce holds it still for anyone who has asked the OS for that.
    <div
      className={`grid shrink-0 overflow-hidden transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none ${
        hidden ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100"
      }`}
      // Hidden from the keyboard as well as the eye while it is folded away —
      // tabbing into a button in a zero-height strip is a focus that goes
      // somewhere invisible.
      inert={hidden || undefined}
    >
      <div className="min-h-0">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div className="min-w-0">
            <h1 className="truncate text-lg text-navy-800 sm:text-xl">{title}</h1>
            {subtitle && <p className="text-sm text-steel">{subtitle}</p>}
          </div>
          {children && <div className="flex flex-wrap items-center gap-2 sm:shrink-0">{children}</div>}
        </div>
      </div>
    </div>
  );
}
