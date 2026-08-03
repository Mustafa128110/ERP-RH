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

  const GAP = 6;
  const EDGE = 8;

  function show() {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;

    if (placement === "right") {
      // Beside the trigger, flipping to its left only when the panel wouldn't
      // fit — and pinned inside the viewport top and bottom, so an icon at
      // either end of the rail still shows its whole label.
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
      // Pull back in when the trigger is close to the right edge.
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
      onMouseLeave={() => setPos(null)}
      onFocus={show}
      onBlur={() => setPos(null)}
      className={triggerClassName}
    >
      {trigger}
      {pos &&
        createPortal(
          <div
            role="tooltip"
            style={{ left: pos.left, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxHeight }}
            className={`pointer-events-none fixed z-50 overflow-hidden rounded-lg border border-sand bg-white p-3 text-sm text-ink shadow-xl ${panelClassName ?? ""}`}
          >
            {children}
          </div>,
          document.body,
        )}
    </span>
  );
}
