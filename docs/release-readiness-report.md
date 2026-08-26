# ERP integrity remediation — release-readiness report

Date: 2026-08-26

## Outcome

The approved application remediation is implemented and passes source,
database, migration-parity, security, and production-build verification.  The
application is **not yet authorised for production cutover** until the external
operational gates below are completed.

## Implemented controls

- Financial records use lifecycle-safe posting and cancellation flows rather
  than hard deletion for sales, purchases, payments, returns, stock movements,
  manual ledger entries, transfers, market purchases and inter-company flows.
- The general ledger posts balanced, reversible double-entry journals only on
  or after each company's configured forward-only cutover date.  Historic
  documents are deliberately not backfilled.
- General-ledger source references are constrained to their company at the
  database level; the system chart, settlement-account mappings, opening
  journals and account deactivation protections are available in GL Setup.
- Product unit conversions are reciprocal and composable.  Missing base units
  or rules do not block sales; product indicators make missing setup visible.
- Inventory value uses FIFO purchase-cost layers.  Stock adjustments present
  the last three unique purchase rates and retain the selected cost source.
- Redis-backed cache invalidation is shared across server instances.  A
  production server refuses to start without a valid `REDIS_URL`; if Redis
  becomes unavailable later, reads bypass cache rather than using stale local
  data.
- Drizzle and Supabase migration histories are mirrored and checked
  byte-for-byte for all 66 migrations.
- Offline queue, session isolation, audit logging, permission/scope guards and
  WhatsApp handoff controls are covered by existing and added checks.

## Verification evidence

- `npm run typecheck`
- `npm run lint`
- `npm run check:offline`
- All checks within `npm run check:db`, run against the configured database
  (including FIFO, payment allocation, settlement, reports, session scope,
  operation idempotency and general-ledger constraints).
- `npm audit --omit=dev --audit-level=high` — no production vulnerabilities.
- `next build` — optimized build produced its `BUILD_ID`.

## Required external release gates

1. Set a valid production `REDIS_URL` before deploying.  Startup now rejects a
   production instance without it.
2. Confirm the Supabase backup/PITR retention policy, create a verified backup,
   and complete a restore drill into a scratch environment.
3. Apply the reviewed Supabase migration history to the scratch environment,
   then run the source and database suites against that restored database.
4. Reconcile opening balances for each company, initialize its chart, map cash
   and bank accounts, create opening journals, and only then set its GL cutover
   date.
5. Reconcile the first post-cutover Trial Balance and General Ledger before the
   next accounting close.

The operational sequence and rollback boundary are defined in
`docs/production-cutover-runbook.md`.

## Test limitation

Automated checks and the production build passed.  Browser-level interactive
smoke testing could not be run because the local Codex browser runtime failed
to initialize due to a missing kernel-assets path.  This is a local tooling
limitation, not an application test failure; conduct the finance-screen smoke
test after the browser runtime is repaired.
