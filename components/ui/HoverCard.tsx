"use client";

import { useRef, useState } from "react";
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
  panelWidth = 260,
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
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; maxHeight: number } | null>(null);
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
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;

    if (placement === "right") {
      const flipLeft = rect.right + GAP + panelWidth + EDGE > window.innerWidth;
      setPos({
        left: flipLeft ? Math.max(EDGE, rect.left - GAP - panelWidth) : rect.right + GAP,
        top: Math.max(EDGE, Math.min(rect.top + rect.height / 2 - estimatedHeight / 2, window.innerHeight - estimatedHeight - EDGE)),
        maxHeight: window.innerHeight - 2 * EDGE,
      });
      return;
    }

    const spaceBelow = window.innerHeight - rect.bottom - GAP - EDGE;
    const spaceAbove = rect.top - GAP - EDGE;
    const flipUp = spaceBelow < estimatedHeight && spaceAbove > spaceBelow;

    setPos({
      left: Math.max(EDGE, Math.min(rect.left, window.innerWidth - panelWidth - EDGE)),
      top: flipUp ? undefined : rect.bottom + GAP,
      bottom: flipUp ? window.innerHeight - rect.top + GAP : undefined,
      maxHeight: Math.max(flipUp ? spaceAbove : spaceBelow, 80),
    });
  }

  return (
    // Focus shows it too: on the collapsed sidebar the icon is the only thing
    // naming the page, and tabbing through must not be a row of blank squares.
    <span
      ref={ref}
      onMouseEnter={show}
      onMouseLeave={scheduleClose}
      onFocus={show}
      onBlur={() => setPos(null)}
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
            style={{ left: pos.left, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxHeight }}
            className={`fixed z-50 overflow-hidden rounded-lg border border-sand bg-white p-3 text-sm text-ink shadow-xl ${panelClassName ?? ""}`}
          >
            {children}
          </div>,
          document.body,
        )}
    </span>
  );
}
