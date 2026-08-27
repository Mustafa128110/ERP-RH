# Mobile UX implementation plan

## Product rules

- A phone view must never create horizontal page scrolling. Tables may scroll only
  inside a clearly bounded accounting matrix, and must preserve a readable primary
  identity.
- Text wraps at word boundaries and at otherwise unbreakable identifiers. Numeric
  values use tabular figures, a minimum inline size of zero, and never silently
  overflow their card, cell, or action bar.
- Controls are at least 44 CSS pixels high on touch devices. Primary actions are
  full width below `sm` unless they are part of a compact, clearly labelled
  toolbar.
- Expected failures are visible semantic alerts; progress and successful work use
  polite status announcements. A failed save/export keeps the user's work and
  offers a precise retry path.
- Motion is short (150–200ms), communicates a state change, and is disabled for
  `prefers-reduced-motion`.

## Route matrix and adoption status

| Route family | Mobile treatment | Status |
| --- | --- | --- |
| `/`, `/login` | Redirect/loading shell; safe-area-aware single-column accessible sign-in form | Implemented |
| Dashboard shell and `/dashboard` | Branded content skeleton, route transition, resilient stat cards and wrapped list values | Implemented |
| `/sales`, `/sales/new`, `/sales/[id]` | Fluid document fields; item-first, two-row line editor; contained totals/actions | Implemented for SaleForm |
| `/sales/invoices`, `/sales/invoices/[id]` | Responsive list cards; stacked invoice screen lines; PDF/PNG export share sheet | Implemented |
| `/sales/quotations*` | Item-first responsive line editor, fluid document controls, compact document actions | Implemented |
| `/purchases/stock`, `/purchases/market` | Item-first stock-purchase line editor; fluid controls. Market purchase remains its focused single-entry layout. | Implemented / QA retained |
| Inventory list routes | Existing DataTable mobile summary cards with full wrapped detail values | Implemented globally |
| Inventory document routes | Item-first responsive document lines, fluid controls, stacked detail headers; read-only adjustment facts | Implemented |
| `/accounts*`, `/ledger`, `/payments`, `/expenses`, `/costing` | DataTable mobile cards; ledger PNG/PDF share sheet; dense calculators use bounded swipeable matrices. | Implemented / manual calculator QA retained |
| `/contacts`, `/companies`, `/taxes`, `/roles`, `/users`, `/audit-logs` | DataTable mobile cards; fluid dialogs/forms | Global list implementation; per-form QA follow-up |
| `/reports*` | Responsive report rows and protected fact totals; CSV remains direct download | Implemented through shared table/fact rules |
| `/settings`, `/settings/backups` | Fluid controls and stacked export rows | Implemented |
| `/whatsapp` | One-column handoff, 48px controls, semantic operational errors | Implemented |

## Responsive components

### DataTable

`DataTable` remains the one shared list component. At `md` and above it retains
the compact sortable table. Below `md`, the exact same table markup becomes a
stack of labelled record cards: each visible `td[data-label]` is a labelled fact,
keeps row selection/search/sort/keyboard behaviour, and wraps arbitrary text.
The table header is visually hidden rather than removed, keeping header
associations for assistive technology. Purpose-built accounting matrices remain
inside `.matrix-scroll` and advertise their horizontal scroll affordance.

### Document lines

Sales line items preserve their fast desktop grid. Below `md`, each row is a
card: Item spans the first full row; Unit, Quantity, Rate List, Unit Price, and
Total form the facts below it; Market Buy and Remove remain visible controls.
This is implemented in `SaleForm`, stock purchase, quotation, adjustment,
transfer, and inter-company forms. Sales uses its tighter five-fact row; other
documents use an item-first, labelled compact fact grid because their columns
do not share one accounting schema.

### Overflow and typography

`mobile-fact`, `safe-wrap`, and `numeric-contain` are shared containment
classes. They are required for new mobile fact views. Use `min-w-0` on every
flex/grid text child and `overflow-wrap:anywhere` for user-entered identifiers.
Do not globally hide overflow, truncate monetary values, or reduce readable
body text below 14px.

## Interaction, loading, errors, and sharing

- `(dashboard)/template.tsx` provides a 180ms opacity/translate route transition
  without blocking navigation or adding a delay. It respects reduced motion.
- `(dashboard)/loading.tsx` is a branded shell with card and list skeletons;
  future costly detail routes should add matching local `loading.tsx` files.
- `alertErrorClass`, `alertSuccessClass`, and `confirmNoticeClass` define inline
  semantic message surfaces. Callers use `role="alert"` for failures and
  `role="status" aria-live="polite"` for progress/success.
- `ExportShareProvider` lives in the dashboard layout. PNG/PDF generators return
  a blob-first `ExportFile`; the file downloads, then one `ExportShareSheet`
  opens with file name/size, Share file, Download again, and Done. Native share
  uses a `File` and `navigator.canShare`; an unsupported browser or a cancelled
  share is not an error. CSV deliberately remains a direct download.
- Browser `confirm()` destructive flows are not changed in this bounded pass.
  Replace them with a shared confirmation Dialog in a later, route-by-route
  change so monetary confirmation rules are not accidentally altered.

## QA matrix

Manually verify each adopted family at 320×568, 360×800, 390×844, 412×915,
768×1024, 1024×768, and 1440×900 in light and dark themes. Also verify 200%
browser zoom, long unbroken SKU/customer/company names, a 15+ digit formatted
amount, keyboard list navigation, screen-reader announcements, offline loading,
and reduced-motion mode. For export test Android/iOS native file share where
available, desktop unsupported-share fallback, cancellation, and generation
failure.

## Verification contract

`lib/mobile-ui.check.ts` asserts the mobile DataTable, sales and generic
document-line structural hooks, matrix containment, export provider, and
dashboard transition remain present.
Run it through `npm run check:offline`.
