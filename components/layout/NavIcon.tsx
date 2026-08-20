import type { ReactNode } from "react";

// One glyph per nav entry, for the collapsed sidebar — where the label is gone
// and the icon is the only thing left to navigate by.
//
// Design note: hand-drawn paths rather than an icon package. It's one shape per
// route on a 24-grid, all stroked in currentColor so they inherit the link's
// active/hover colours for free — a dependency would be 200kB to draw the same
// thirty lines. Add a package if the app ever needs icons by the hundred.
//
// Keyed by href rather than declared in lib/nav-config.ts so the nav stays plain
// data. A route with no entry here falls back to the first two letters of its
// label, which keeps a newly added page navigable rather than blank.
const SHAPES: Record<string, ReactNode> = {
  "/dashboard": <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" />,

  // --- Inventory ---
  "/inventory/products": (
    <>
      <path d="M12 3l8 4v10l-8 4-8-4V7z" />
      <path d="M4 7l8 4 8-4M12 11v10" />
    </>
  ),
  "/inventory/categories": <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />,
  "/inventory/brands": (
    <>
      <path d="M11 3H4v7l10 10 7-7z" />
      <circle cx="7.5" cy="7.5" r="1.2" />
    </>
  ),
  "/inventory/units": (
    <>
      <path d="M3 14L14 3l7 7L10 21z" />
      <path d="M8 9l2 2M11 6l2 2M5 12l2 2" />
    </>
  ),
  "/inventory/unit-conversions": <path d="M4 8h13l-3-3M20 16H7l3 3" />,
  "/inventory/warehouses": (
    <>
      <path d="M3 10l9-5 9 5v10H3z" />
      <path d="M8 20v-6h8v6" />
    </>
  ),
  "/inventory/stock": (
    <>
      <path d="M12 3l9 5-9 5-9-5z" />
      <path d="M3 13l9 5 9-5" />
    </>
  ),
  "/inventory/stock-transfers": <path d="M4 8h12m-3-3l3 3-3 3M20 16H8m3-3l-3 3 3 3" />,
  "/inventory/inter-company": (
    <>
      <path d="M4 21V8l6-3v16" />
      <path d="M14 21V11l6 3v7M3 21h18" />
    </>
  ),
  "/inventory/stock-adjustments": (
    <>
      <path d="M5 21v-7M5 10V3M12 21v-9M12 8V3M19 21v-5M19 12V3" />
      <path d="M2 14h6M9 8h6M16 16h6" />
    </>
  ),
  "/inventory/stock-movements": <path d="M3 12h4l3 7 4-14 3 7h4" />,

  // --- Purchases ---
  "/purchases/stock": (
    <>
      <path d="M3 4h2l2.5 11h10L20 7H6" />
      <circle cx="9" cy="19" r="1.5" />
      <circle cx="17" cy="19" r="1.5" />
    </>
  ),
  "/purchases/market": (
    <>
      <path d="M3 5h18v4H3zM5 9v11h14V9M8 13h8M8 17h5" />
      <path d="M7 5V3m10 2V3" />
    </>
  ),
  "/contacts": (
    <>
      <circle cx="9.5" cy="7" r="3.5" />
      <path d="M16 20v-2a4 4 0 00-4-4H7a4 4 0 00-4 4v2M17 4a3.5 3.5 0 010 7" />
    </>
  ),

  // --- Sales ---
  "/sales": (
    <>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
    </>
  ),
  "/sales/invoices": (
    <>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4M9 12h6M9 16h4" />
    </>
  ),
  "/sales/quotations": (
    <>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4M9 13h5m-2-2l2 2-2 2" />
    </>
  ),

  // --- Finance ---
  "/accounts": (
    <>
      <path d="M3 10l9-6 9 6" />
      <path d="M5 10v8M10 10v8M14 10v8M19 10v8M3 21h18" />
    </>
  ),
  "/payments": (
    <>
      <rect x="2.5" y="5" width="19" height="14" rx="2" />
      <path d="M2.5 10h19" />
    </>
  ),
  "/ledger": (
    <>
      <path d="M5 4a2 2 0 012-2h12v18H7a2 2 0 00-2 2z" />
      <path d="M9 7h7" />
    </>
  ),
  "/expenses": (
    <>
      <path d="M3 8a2 2 0 012-2h13a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
      <path d="M16 12h.5M3 9h17" />
    </>
  ),
  "/taxes": (
    <>
      <path d="M19 5L5 19" />
      <circle cx="7.5" cy="7.5" r="2.5" />
      <circle cx="16.5" cy="16.5" r="2.5" />
    </>
  ),

  // --- Communication / Reporting ---
  "/whatsapp": <path d="M21 12a8 8 0 01-11.6 7.1L4 21l1.9-5.4A8 8 0 1121 12z" />,
  "/reports": (
    <>
      <path d="M3 21h18" />
      <path d="M6 21V11M11 21V5M16 21v-8" />
    </>
  ),

  // --- Administration ---
  "/users": (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20a8 8 0 0116 0" />
    </>
  ),
  "/roles": <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />,
  "/companies": (
    <>
      <path d="M4 21V5a2 2 0 012-2h7a2 2 0 012 2v16" />
      <path d="M15 9h3a2 2 0 012 2v10M8 8h3M8 12h3M8 16h3M3 21h18" />
    </>
  ),
  "/audit-logs": (
    <>
      <path d="M4 6h10M4 12h7M4 18h6" />
      <circle cx="17" cy="15" r="4" />
      <path d="M17 13.5V15l1.2 1" />
    </>
  ),
  "/settings": (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5.2 5.2l2.1 2.1M16.7 16.7l2.1 2.1M18.8 5.2l-2.1 2.1M7.3 16.7l-2.1 2.1" />
    </>
  ),
};

export function NavIcon({ href, label }: { href: string; label: string }) {
  const shape = SHAPES[href];
  if (!shape) {
    return (
      <span aria-hidden className="text-[11px] font-semibold uppercase">
        {label.slice(0, 2)}
      </span>
    );
  }
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="h-5 w-5"
    >
      {shape}
    </svg>
  );
}
