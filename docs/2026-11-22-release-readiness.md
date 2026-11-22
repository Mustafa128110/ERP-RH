# Royal Hardware ERP release readiness

Date: 22 November 2026 (Asia/Karachi)

## Release candidate

The application uses one company with shared Settings channels. The Stock
workspace combines products, quantities, transfers, adjustments and conversions.
Contacts have channel ledgers, complete-ledger merges and retained-history balance
closing. Partial merges are removed, including their selection API; old queued
partial requests are refused without changing data. Sales support complete and
selected-product returns. Reports include historical monthly and daily profit.
Sorting accumulates numbered priorities; sales invoices default to invoice number.
Column sizing is shared, and ledger image/PDF exports paginate on A4.

## Verification

- `npm run check`: typecheck, lint, offline checks and WhatsApp logic passed after
  removal of partial merges.
- `npm run check:db`: the complete suite passed on an isolated restored database.
  The updated complete-ledger merge check also passed with all fixtures rolled
  back, including refusal of old partial requests and preservation of financial
  history, opening balances, payment allocations, cash and later settlements.
- `npm run check:single-company:browser`: real components with isolated actions
  passed for channels, payment controls, permission presets, shared column sizes,
  sort priorities, returns, stock conversion, historical profit and ledger flows.
  The export check retained all 225 rows across ten A4 PNG pages and a PDF.
- The final production build and production environment preflight passed.
- Read-only production postconditions confirm the single company, migration
  hashes, channel tags, user membership coverage and valid constraints.

## Data protection

Migrations 0075 and 0076 are already applied. They were rehearsed against restored
copies and committed only after financial/stock preservation assertions passed.
Original consolidation records remain in private history. No further database
migration is needed for this release.

Encrypted database and source/configuration backups remain local, as requested.
All 71 ERP, authentication and migration-history tables were independently
restore-verified. The full-ledger-only source recovery archive was extracted and
checked file by file. See the local backup folders' `RECOVERY.txt` and verification
reports. Keep the archive password separately.

`.vercelignore` excludes environment credentials, recovery data, reference files,
Git history and local build/dependency caches from deployment uploads.

## Publishing status

The owner requested publishing through the existing Git integration. Commit
`71347ea` was pushed to `main` in `Mustafa128110/ERP-RH`. Vercel reported a
successful Production deployment at
`https://erp-33wxbc2cg-rh-2e75.vercel.app`.

Read-only browser checks at `https://erp.royalhardware.co` passed: sign-in renders,
the manifest and build assets load, protected pages redirect when signed out, and
there are no page errors or failed build assets. GitHub's application source
checks passed; its dependency audit identified packages requiring a compatible
security update. The follow-up updates Next.js to 16.4.6 and the affected
transitive dependencies. It reports zero vulnerabilities, and the complete source
checks, production build and browser/export suite pass with the patched packages.

Git now preserves the exact bytes of the applied 0076 migration and its mirror,
so cloning on another platform retains the recorded database checksum. The SQL
and database records are unchanged by this checksum preservation. Local backup
archives and credentials remain excluded from Git and hosting uploads.
