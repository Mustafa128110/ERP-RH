<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Invariants

Rules this codebase holds itself to. Breaking one is a bug even when it compiles.

**No mutation throws.** Every write in `lib/actions/*` is wrapped in `guard()`
(`lib/actions/guard.ts`) and returns `{ error }` rather than throwing. A server
action that throws unmounts the form, and the twenty rows someone had pasted into
a batch grid go with it. Add `guard` to any new action; give it a fallback
sentence about *that* operation, and a `{ [DUPLICATE]: … }` override where the
table's constraints have a better wording.

**No loops of statements inside a transaction.** Every statement in a
transaction is its own round trip to a database ~170ms away, so N rows means N
round trips. Batch writes use `UPDATE … FROM (VALUES …)`, a single multi-row
`INSERT`, or a window function — see `saveCategoryTree`, `updateContactsBatch`,
`mergeStockPurchases`. Aggregate in SQL, not in JS.

**Every mutation records an audit entry.** `recordAudit()`
(`lib/actions/audit.ts`) after the write, before the return. It never throws, so
it can't take down the operation it describes.

**Every cached lookup is invalidated by whoever writes its table.**
`lib/cache.check.ts` asserts this and fails the check suite if a new action
writes a cached table without calling `invalidateLookups`.

**`"use server"` modules export async functions only.** Constants and type
guards live in a sibling: `lib/sale-constants.ts`, `lib/report-constants.ts`,
`lib/setting-constants.ts`, `lib/backup-constants.ts`. SQL that takes an
already-resolved scope lives in `lib/queries/*`, so it can be checked without a
session — `lib/queries/reports.check.ts` is why that split exists.

**No invented data.** A screen shows what the database holds or it says there is
nothing. Thirteen pages once rendered fixtures as though they were records; that
is the single worst thing this codebase has done to the people using it.

**One list component, one hover component, one shortcut list.** Lists are
`DataTable` (arrow keys, tick columns, instant search from one
`searchPlaceholder` prop). Extra detail behind a cell is `DetailHover` — it
computes its own panel height, which is what keeps the last row's panel on
screen. Keys the app answers to live in `lib/shortcuts.ts`, and the same list
draws the `?` help sheet, so a shortcut cannot exist without being documented.
Plain master-data screens are `RecordManager`; only a screen that genuinely
differs gets its own component.

**The WhatsApp assistant has no write path of its own.** `lib/whatsapp-agent/`
resolves an inbound number to a real user (`identity.ts`, an `AsyncLocalStorage`
that `getSession()` reads) and then calls the same Server Actions the web UI
posts to — so numbering, stock, ledger, permissions and audit are the same code,
not a copy. Three rules hold it together: an unmapped number gets **no reply at
all**; the model never writes SQL, it picks from `tools.ts`; and **no write
posts without a "yes"** — a draft waits in `pending.ts`, and taking it consumes
it, so a redelivered webhook can't post twice. Message content is data, never
instruction.

**Sending to a customer is free by default.** `waMeLink()` opens the message in
the user's own WhatsApp — no provider, no per-message fee, no ban risk. The
Cloud API path stays as a secondary option and is logged as `sent`; the free one
is logged as `handoff`, because whether a finger pressed send is not something
this system can know.

# Checks

    npm run check         typecheck + lint + every offline check
    npm run check:offline pure logic, no database
    npm run check:db      runs against .env — cache coverage, sequences,
                          session query, and all eleven reports

New non-trivial logic leaves one runnable check behind, in the `*.check.ts`
convention already in use. No test framework — `node:assert` and a `main()`.
