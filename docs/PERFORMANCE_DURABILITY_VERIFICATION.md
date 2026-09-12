# Performance and durability verification — 2026-09-12

The changes extend the durable-save release ad36a3b. They use the existing browser storage, PostgreSQL, Redis, GitHub Actions and R2 configuration; no paid service or dependency was added. Usage still counts toward the existing providers' quotas.

## Measured results

| Measurement | Before median | After median | Scope |
| --- | ---: | ---: | --- |
| Dashboard SQL | 212.6 ms | 102.9 ms | Five alternating warm reads from this machine to Singapore; same company scopes and output |
| Open 10,000-option picker | 540.8 ms | 26.4 ms | Five browser samples using the old and new actual ComboBox components |
| Mounted rows in 5,000-record table | — | 20 | Full search/selection, final-row keyboard navigation, mobile and complete printing verified |

Raw samples are in dashboard-performance.json and picker-performance.json. The picker mounted 11 options. The slowest new picker sample was 273.9 ms, so medians are not a worst-case guarantee. These measurements do not establish a blanket percentage improvement for every page or network.

## Recovery coverage

Specialized quotation, stock transfer and inter-company editors now preserve complete draft headers and lines against their original database versions. Inter-company recovery tracks both documents. Contact, payment, expense, bank/cash account, cheque, category, role, unit conversion, conversion assignment and opening-balance edits share recovery controls. Cash transfer, role/unit-rule creation, market confirmation and sales return input are also preserved. Product/contact batch edits carry the selected records' original revisions. Master batch creation preserves rows; payment and expense batches also retain the common date. Password-bearing user batches remain excluded.

IndexedDB must commit before the UI acknowledges a background save. Draft input transfers to the queue only after that commit. Stale draft versions cannot overwrite a newer record. Confirmed commands older than seven days may compact their input only when outside the newest 100 confirmations; permanent receipt identity and a SHA-256 input identity remain. Pending, syncing and failed input is never compacted.

The immediate UI acknowledges locally stored work. Official server-generated invoice numbers and authoritative balances appear after confirmation. Browser data deletion or loss of the device can destroy work that has not yet reached the server; no browser-only implementation can promise absolute zero loss.

## Database and cache

Migration 0074 creates private database cache generations and statement-level parent version triggers. A transaction advances its affected tables' generations atomically; readers include these in their cache keys. A writer that cannot deliver a Redis invalidation cannot leave another instance serving its previous generation. A revision lookup or Redis failure bypasses caching. Child-only document, permission, conversion and financial writes also advance relevant editor versions.

0074 was first applied to a fresh disposable restore and then applied and registered as 20260911000074 on ERP-System (Singapore), gvneuhadkktmhoxaazzg. Earlier migration journal discrepancies remain untouched; do not replay the whole migration directory.

## Verification

- `npm run check`: TypeScript, lint and all offline invariants passed.
- `npm run build`: production build passed.
- `npm run check:recovery:browser`: all six suites passed, covering IndexedDB and quota failures, reload recovery, exact edit versions, offline next-entry reset, collection/date/conditional input, batch handoff, queue compaction, history search/sort/navigation and full printing.
- `npm run check:recovery:db`: real sale, purchase, payment and expense actions on a disposable restored database passed concurrent same-operation submission, lost acknowledgement replay, distinct concurrent sale numbering, interrupted transaction rollback/retry, stale child version and permission revocation checks. An independent writer/reader cache test passed with invalidation delivery lost and Redis unavailable.
- Dashboard query equivalence and history pagination checks passed on database snapshots. Database cache trigger coverage, atomic generation changes and rollback isolation passed.
- `python scripts/backup-retention.check.py`: retention preserves protected/unknown keys, recent copies and weekly/monthly recovery points.

Browser scripts accept `PLAYWRIGHT_MODULE` and `ERP_BROWSER_EXECUTABLE` when using a bundled browser runtime. Local financial/cache failure tests refuse hosted targets; provide `DATABASE_URL_DIRECT=postgresql://restore_verify@127.0.0.1:55474/restore_<timestamp>` after a disposable restore.

## Backup evidence

The pre-migration backup taken 2026-09-12 has SHA-256 `60fb734147a06796328bfae19498aee04b16857743485fad9ef39decd4f7d4b9`. A fresh PostgreSQL 17 restore matched all 38 public table fingerprints, 10,485 rows and constraints, and restored three auth identities. Encrypted archives and detailed manifests remain in ignored db-export directories. Provider-owned hosted services need separate Supabase provisioning.

The updated backup workflow retains daily/weekly/monthly encrypted history and triggers a disposable restore after each successful backup. Hosted run and deployment results will be added after release verification. Remaining plan items are tracked explicitly in COMPLETION_TRACKER.md.
