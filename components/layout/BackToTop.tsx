"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";

// The button in the bottom-right that puts you back at the top of whatever you
// are reading. Mounted once in the dashboard layout rather than per page, so
// every screen has it without asking.
//
// "Whatever you are reading" is doing some work there: this app has two kinds
// of scrolling — a list scrolls inside DataTable's own overflow container while
// the page around it stays put, and a form or a report scrolls <main>. So the
// button remembers the element that last fired a scroll event (captured on the
// document, since scroll events do not bubble) and sends that one home. A
// window.scrollTo() would do nothing at all on a list page.
const SHOW_AFTER = 200;

export function BackToTop() {
  const [visible, setVisible] = useState(false);
  const container = useRef<HTMLElement | null>(null);

  useEffect(() => {
    function onScroll(e: Event) {
      const target = e.target;
      if (target instanceof HTMLElement) {
        container.current = target;
        setVisible(target.scrollTop > SHOW_AFTER);
      } else {
        container.current = null;
        setVisible(window.scrollY > SHOW_AFTER);
      }
    }
    document.addEventListener("scroll", onScroll, true);
    return () => document.removeEventListener("scroll", onScroll, true);
  }, []);

  function toTop() {
    const el = container.current;
    if (el) el.scrollTo({ top: 0, behavior: "smooth" });
    else window.scrollTo({ top: 0, behavior: "smooth" });
    setVisible(false);
  }

  return (
    <button
      type="button"
      onClick={toTop}
      // Kept mounted and faded, rather than mounted on demand: appearing out of
      // nothing under the cursor is how you get a mis-click on the row beneath.
      // pointer-events-none while hidden so it cannot take that click either.
      className={`fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-4 z-40 flex h-12 w-12 items-center justify-center rounded-full border border-sand bg-white text-navy-800 shadow-xl transition-opacity duration-200 motion-reduce:transition-none hover:bg-ivory print:hidden ${
        visible ? "opacity-100" : "pointer-events-none opacity-0"
      }`}
      aria-label="Back to top"
      title="Back to top"
      // Not a tab stop while invisible.
      tabIndex={visible ? 0 : -1}
      aria-hidden={!visible}
    >
      <Icon name="chevronUp" className="h-6 w-6" />
    </button>
  );
}
