"use client";

import { Fragment, type ReactNode } from "react";
import { HoverCard } from "@/components/ui/HoverCard";

// The "hover a cell to see what's behind it" panel, written once.
//
// Five lists had their own copy of this — each with its own LINE_HEIGHT and
// PANEL_CHROME constants, each doing the same arithmetic to guess how tall the
// panel would be so HoverCard could decide whether to flip it above the row.
// Getting that number wrong is what put the last row's panel off the bottom of
// the screen, so it is exactly the sort of thing that should be computed in one
// place rather than remembered in five.
//
// Two shapes, because that is all any of them needed:
//
//   rows      label / value pairs, right-aligned values (a ledger, totals)
//   lines     a heading and a list of things (the items on an invoice)
//
// Anything richer passes `children` and sizes itself with `extraHeight`.

// Measured against the rendered panel: a row of 13px text in a 3-unit grid gap.
const LINE_HEIGHT = 21;
// Border, padding and the heading line.
const PANEL_CHROME = 52;

export type HoverRow = {
  label: string;
  value: ReactNode;
  // Dimmed middle column — the direction of a payment, the unit of a quantity.
  note?: string;
};

export function DetailHover({
  trigger,
  heading,
  rows,
  lines,
  footer,
  children,
  width = 272,
  extraHeight = 0,
  placement = "bottom",
  // A long list is truncated rather than scrolled: the panel is
  // pointer-events-none (a wheel goes to the page behind it), so anything past
  // the fold would be unreachable. The record itself is one click away.
  max = 12,
}: {
  // What is hovered. Rendered with the dotted underline that marks a cell as
  // having more behind it — the affordance is the same everywhere, so it only
  // has to be learned once.
  trigger: ReactNode;
  heading?: string;
  rows?: HoverRow[];
  lines?: { text: string; note?: string; value?: ReactNode }[];
  footer?: string;
  children?: ReactNode;
  width?: number;
  extraHeight?: number;
  placement?: "bottom" | "right";
  max?: number;
}) {
  const shownLines = lines?.slice(0, max) ?? [];
  const hiddenLines = (lines?.length ?? 0) - shownLines.length;

  // Every visible row, plus a line for the heading, the "+N more" line and the
  // footer when they're there. This is the whole reason the component exists.
  const count = (rows?.length ?? 0) + shownLines.length + (hiddenLines > 0 ? 1 : 0) + (footer ? 1 : 0);
  const estimatedHeight = PANEL_CHROME + (heading ? LINE_HEIGHT : 0) + count * LINE_HEIGHT + extraHeight;

  return (
    <HoverCard
      triggerClassName="underline decoration-dotted decoration-zinc-400 underline-offset-4"
      panelClassName="w-max"
      panelWidth={width}
      estimatedHeight={estimatedHeight}
      placement={placement}
      trigger={trigger}
    >
      {heading && <span className="mb-2 block font-semibold text-navy-800">{heading}</span>}

      {rows && rows.length > 0 && (
        <span className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1">
          {rows.map((r, i) => (
            <Fragment key={i}>
              <span className="whitespace-nowrap text-steel">{r.label}</span>
              <span className="text-right tabular-nums text-ink">
                {r.value}
                {r.note && <span className="ml-1 text-steel">{r.note}</span>}
              </span>
            </Fragment>
          ))}
        </span>
      )}

      {lines && lines.length > 0 && (
        <span className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1">
          {shownLines.map((l, i) => (
            <Fragment key={i}>
              <span className="truncate text-ink">
                {l.text}
                {l.note && <span className="ml-1 text-steel">{l.note}</span>}
              </span>
              <span className="text-right tabular-nums text-steel">{l.value}</span>
            </Fragment>
          ))}
          {hiddenLines > 0 && <span className="col-span-2 text-steel">+{hiddenLines} more</span>}
        </span>
      )}

      {children}

      {footer && <span className="mt-2 block border-t border-sand pt-2 text-xs text-steel">{footer}</span>}
    </HoverCard>
  );
}
