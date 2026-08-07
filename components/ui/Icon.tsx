import type { ReactNode } from "react";

// The action glyphs — the ones that sit on buttons, as opposed to the one-per-
// route shapes in components/layout/NavIcon.tsx. Same drawing rules as that
// file (24-grid, currentColor, 1.7 stroke, round joints) so a toolbar and the
// sidebar look like they were drawn by the same hand, and same reasoning for
// hand-drawn paths over a package: this is a dozen shapes, not two hundred.
//
// Sized in rem via h-5/w-5 rather than fixed pixels, so an icon grows with the
// zoom setting (users.ui_scale) along with the text beside it. An icon that
// stayed 20px while the label went to 175% is the tell of a half-done zoom.

const PATHS: Record<string, ReactNode> = {
  plus: <path d="M12 5v14M5 12h14" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6L6 18" />,
  // Into the app: arrow pointing down into a tray.
  import: (
    <>
      <path d="M12 3v11M8 10l4 4 4-4" />
      <path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
    </>
  ),
  // Out of the app: the same tray, arrow leaving it.
  export: (
    <>
      <path d="M12 14V3M8 7l4-4 4 4" />
      <path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
    </>
  ),
  template: (
    <>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4M9 12h6M9 16h4" />
    </>
  ),
  chevronUp: <path d="M6 15l6-6 6 6" />,
  chevronDown: <path d="M6 9l6 6 6-6" />,
  chevronLeft: <path d="M15 6l-6 6 6 6" />,
  chevronRight: <path d="M9 6l6 6-6 6" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
    </>
  ),
  moon: <path d="M20 14.5A8.5 8.5 0 019.5 4a8.5 8.5 0 1010.5 10.5z" />,
  edit: (
    <>
      <path d="M4 20h4l10-10a2.8 2.8 0 10-4-4L4 16z" />
      <path d="M13.5 6.5l4 4" />
    </>
  ),
  // Two lines becoming one — merging records.
  merge: (
    <>
      <path d="M7 4v5a4 4 0 004 4h6" />
      <path d="M7 20v-5a4 4 0 014-4h6" />
      <path d="M15 10l3 3-3 3" />
    </>
  ),
  // The three-dot "and the rest of them", for the collapsed CSV group.
  more: (
    <>
      <circle cx="5" cy="12" r="1.3" />
      <circle cx="12" cy="12" r="1.3" />
      <circle cx="19" cy="12" r="1.3" />
    </>
  ),
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, className = "h-5 w-5" }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      {PATHS[name]}
    </svg>
  );
}
