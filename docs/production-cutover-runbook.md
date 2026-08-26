# Production cutover runbook

This runbook applies to the integrity-remediation release dated 2026-08-26.
It covers the approved forward-only general-ledger cutover.  It does **not**
backfill general-ledger entries for historical documents.

## Release gates

Do not deploy until all of these are true:

1. The Supabase migration history mirrors every Drizzle migration through
   `drizzle/0065_friendly_blur.sql`.  Run
   `tsx lib/supabase-migration-parity.check.ts` before release; it rejects a
   missing, extra, or changed mirror.
2. Run `npm run check:release` from the configured release environment.  It
   first verifies the production Redis configuration, then runs source,
   database and production-build checks.
3. A verified production backup exists, its retention/PITR window is known,
   and a restore has succeeded in an isolated scratch environment.
4. The scratch restore has applied the release migrations and passed both
   `npm run check` and `npm run check:db` using the restored database.
5. Every affected company has its opening balances reconciled to the approved
   cutover date.  Reconcile cash/bank, receivables, payables, inventory and
   equity before enabling GL.
6. A release owner is available to make the final company-by-company decision.

## Database deployment

1. Take and verify a backup.  Record its timestamp and the restore command or
   console procedure in the release ticket.
2. Bring the Supabase migration mirror into parity, then run the Supabase
   migration command only against a scratch environment first.
3. Apply the same reviewed migration set to production exactly once.  Do not
   use `db:push` as a substitute for a reviewed migration history.
4. Run `npm run check:db` against production.  In particular, the general
   ledger check must report balanced source journals and all three company
   boundary foreign keys.
5. Keep the backup and the prior deployment artefact available until the
   post-cutover reconciliation is signed off.

## Company GL cutover

Repeat these steps for one company at a time:

1. Go to **Finance → GL Setup** and initialize the system chart of accounts.
2. Create any required custom asset, liability, equity, income or expense
   accounts.  Map active cash and bank accounts to active GL asset accounts.
3. Choose and save a cutover date in **Settings**.  It should normally be the
   start of the first new accounting day, after all earlier documents have
   been reconciled.  The fully initialized system chart is required before the
   setting can be saved.
4. Create opening-balance journals dated on the cutover date.  Positive values
   debit the selected account; negative values credit it.  The system posts the
   balancing side to Opening Equity (3000).
5. Verify that the Trial Balance totals balance and that the General Ledger
   contains the expected opening journals.  Check cash/bank, AR, AP,
   inventory, and equity against the approved reconciliation.
6. Existing prior documents remain outside the GL.  New eligible postings on
   or after the cutover date create balanced GL rows automatically.  Once the
   first opening journal has posted, the cutover date is locked.

## After enabling GL

- The cutover date cannot be changed or cleared once the company has a GL
  entry.  This protects the accounting boundary.
- Correct a post-cutover transaction using its approved cancel/reversal flow;
  never edit, delete, or directly insert general-ledger rows.
- A cancelled document receives reversing GL rows.  Ledger views hide those
  rows by default and provide an explicit control to show them.
- Re-run the Trial Balance and General Ledger after the first day of postings.
  Investigate any imbalance before allowing the next accounting close.

## Rollback boundary

Before any company has a GL entry, the cutover setting can be corrected through
Settings.  After entries exist, application-level rollback is intentionally
limited to reversing entries.  A database restore is the only rollback for a
failed schema deployment, which is why the verified backup and scratch restore
are mandatory release gates.
