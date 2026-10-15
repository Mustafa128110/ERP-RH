"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Portals to <body> with fixed positioning computed from the trigger's own rect —
// the tables these live in sit in an overflow-x-auto wrapper, and that CSS quirk
// forces overflow-y to auto too, which silently clips any absolutely positioned
// panel that tries to render below a row. Escaping to a viewport-fixed portal
// sidesteps that entirely.
//
// Placement is clamped to the viewport: hovering the LAST row of a table put the
// panel below the fold where it was unreachable, so a panel with more room above
// than below flips to hang upwards, and the left edge is pulled back in when the
// trigger sits near the right edge. `estimatedHeight` lets a caller say how tall
// its content runs — measuring would mean rendering first, then moving it.
export function HoverCard({
  trigger,
  triggerClassName,
  panelClassName,
  estimatedHeight = 160,
  panelWidth = 560,
  placement = "bottom",
  children,
}: {
  trigger: React.ReactNode;
  triggerClassName?: string;
  panelClassName?: string;
  estimatedHeight?: number;
  panelWidth?: number;
  // "bottom" hangs under the trigger (table rows). "right" sits beside it,
  // centred on it — what a narrow rail of icons needs, where a panel underneath
  // would cover the next icon down.
  placement?: "bottom" | "right";
  children: React.ReactNode;
}) {
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; maxHeight: number; maxWidth: number } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const GAP = 6;
  const EDGE = 8;

  // Close the panel, unless the mouse is hovering the panel itself.
  // The timer gives the mouse time to cross from trigger to panel.
  function scheduleClose() {
    closeTimer.current = setTimeout(() => {
      setPos(null);
    }, 120);
  }

  function cancelClose() {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }

  function show() {
    cancelClose();
    const triggerEl = ref.current;
    if (!triggerEl) return;
    const rect = triggerEl.getBoundingClientRect();

    // Boundary container: if inside a modal dialog or marked boundary, stay inside it
    const container = triggerEl.closest<HTMLElement>('[role="dialog"], [data-hover-container]');
    const containerRect = container?.getBoundingClientRect();

    const minLeft = containerRect ? Math.max(EDGE, containerRect.left + EDGE) : EDGE;
    const maxRight = containerRect ? Math.min(window.innerWidth - EDGE, containerRect.right - EDGE) : window.innerWidth - EDGE;
    const minTop = containerRect ? Math.max(EDGE, containerRect.top + EDGE) : EDGE;
    const maxBottom = containerRect ? Math.min(window.innerHeight - EDGE, containerRect.bottom - EDGE) : window.innerHeight - EDGE;

    const availableWidth = Math.max(60, maxRight - minLeft);
    const maxPanelWidth = Math.min(panelWidth, availableWidth);

    let left: number;
    if (placement === "right") {
      const fitsRight = rect.right + GAP + maxPanelWidth <= maxRight;
      left = fitsRight ? rect.right + GAP : Math.max(minLeft, rect.left - GAP - maxPanelWidth);
    } else {
      if (rect.left + maxPanelWidth <= maxRight) {
        left = Math.max(minLeft, rect.left);
      } else {
        left = Math.max(minLeft, Math.min(rect.right - maxPanelWidth, maxRight - maxPanelWidth));
      }
    }

    const spaceBelow = maxBottom - rect.bottom - GAP;
    const spaceAbove = rect.top - minTop - GAP;
    const flipUp = spaceBelow < estimatedHeight && spaceAbove > spaceBelow;
    const availableHeight = Math.max(60, flipUp ? spaceAbove : spaceBelow);

    setPos({
      left,
      top: flipUp ? undefined : rect.bottom + GAP,
      bottom: flipUp ? window.innerHeight - rect.top + GAP : undefined,
      maxHeight: availableHeight,
      maxWidth: maxPanelWidth,
    });
  }

  // Prevent wheel scrolling on the hover panel from propagating or chaining to the background.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel || !pos) return;

    function onWheel(e: WheelEvent) {
      e.preventDefault();
      e.stopPropagation();

      const scrollable = panel?.querySelector<HTMLElement>(".overflow-y-auto, .overflow-auto, [data-scrollable]");
      if (!scrollable) return;

      if (Math.abs(e.deltaY) >= Math.abs(e.deltaX)) {
        scrollable.scrollTop += e.deltaY;
      } else {
        scrollable.scrollLeft += e.deltaX;
      }
    }

    function onTouchMove(e: TouchEvent) {
      e.stopPropagation();
    }

    panel.addEventListener("wheel", onWheel, { passive: false });
    panel.addEventListener("touchmove", onTouchMove, { passive: true });
    return () => {
      panel.removeEventListener("wheel", onWheel);
      panel.removeEventListener("touchmove", onTouchMove);
    };
  }, [pos]);

  // Close panel if the window or containing scroll container scrolls (outside the hover panel itself)
  useEffect(() => {
    if (!pos) return;
    function onScrollOrResize(e: Event) {
      if (panelRef.current && (panelRef.current === e.target || panelRef.current.contains(e.target as Node))) {
        return;
      }
      setPos(null);
    }
    function onPointerDown(e: PointerEvent | MouseEvent) {
      const target = e.target as Node;
      if (ref.current && ref.current.contains(target)) return;
      if (panelRef.current && panelRef.current.contains(target)) return;
      setPos(null);
    }
    window.addEventListener("resize", onScrollOrResize);
    window.addEventListener("scroll", onScrollOrResize, true);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("resize", onScrollOrResize);
      window.removeEventListener("scroll", onScrollOrResize, true);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [pos]);

  return (
    // Focus shows it too: on the collapsed sidebar the icon is the only thing
    // naming the page, and tabbing through must not be a row of blank squares.
    <span
      ref={ref}
      onMouseEnter={show}
      onMouseLeave={scheduleClose}
      onFocus={show}
      onBlur={() => setPos(null)}
      onClick={(e) => {
        const target = e.target as HTMLElement;
        if (target.closest("a, button, input, select, textarea")) return;
        if (pos) {
          setPos(null);
        } else {
          show();
        }
      }}
      className={triggerClassName}
    >
      {trigger}
      {pos &&
        createPortal(
          <div
            ref={panelRef}
            role="tooltip"
            onMouseEnter={cancelClose}
            onMouseLeave={scheduleClose}
            style={{
              left: pos.left,
              top: pos.top,
              bottom: pos.bottom,
              maxHeight: pos.maxHeight,
              maxWidth: pos.maxWidth,
              boxSizing: "border-box",
            }}
            className={`fixed z-[60] flex flex-col overscroll-contain overflow-hidden rounded-lg border border-sand bg-white p-3 text-sm text-ink shadow-xl max-w-[calc(100vw-1rem)] ${panelClassName ?? ""}`}
          >
            {children}
          </div>,
          document.body,
        )}
    </span>
  );
}
