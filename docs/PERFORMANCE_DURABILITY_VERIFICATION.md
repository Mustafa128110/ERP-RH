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

The updated backup workflow retains daily/weekly/monthly encrypted history and triggers a disposable restore after each successful backup. Hosted [backup run 34679302882](https://github.com/Mustafa128110/ERP-RH/actions/runs/34679302882) and [restore run 34679385602](https://github.com/Mustafa128110/ERP-RH/actions/runs/34679385602) both passed for main commit e208834. Vercel deployment dpl_3B563eJhdFPuz4AcR2xoXhCqPYdx is Ready and serves erp.royalhardware.co with sin1 functions; the live login returned HTTP 200. The hosted quality check passed `npm run check` but failed dependency audit; patching those dependencies is tracked in the follow-up release. Remaining plan items are tracked explicitly in COMPLETION_TRACKER.md.

## Ledger follow-up

The follow-up installs compatible security fixes: Next.js 16.3.5, sharp 0.35.4, browserslist 4.28.9, baseline-browser-mapping 2.11.22 and js-yaml 4.3.2. The dependency audit now reports zero vulnerabilities. The full check, production build, six browser suites and disposable financial/cache failure checks passed after installation. Ledger equivalence also passed read-only against Singapore, and the financial action check confirms actual invoice/purchase lines reach the bounded hover history.

Ledger summaries now aggregate credit/debit in SQL using the existing settlement ownership rules. Recent payments, invoices and purchases rank in SQL and return at most six records per company/contact/kind. Line details are fetched only for those selected documents. Read-only equivalence checks passed on both the local restore and Singapore for empty, individual and combined company scopes. The assembly also fixes an existing bug where copying balances before attaching recent invoices left the returned hover arrays empty.

## Follow-up release result

Main commit `f3892687f3eec71a4f2de07cb76e5fbf6643544e` is deployed as `dpl_H2HY5ARqVBnwufUTUBXNNx6VXcM5` at erp.royalhardware.co with sin1 functions. [Hosted quality run 34680166551](https://github.com/Mustafa128110/ERP-RH/actions/runs/34680166551) passed installation, all checks, dependency audit and production build. The live login returned HTTP 200. The local disposable database server was stopped after verification. No additional database migration was needed for this follow-up.

## Final history completion

The remaining histories now load 100 records or complete groups per page: payments, expenses, quotations, stock transfers, stock adjustments, inter-company sales, cash transfers, market purchases and stock movements. Queries retain company permission scopes before grouping, counting, searching or sorting. Payments and expenses preserve complete daily groups, including groups larger than 100 entries. Confirmed market purchase lines stay together. Stock movements no longer hide everything beyond the newest 500. Page headers identify page-local counts; the pager gives full matching totals. Sort direction uses a separate URL parameter so it cannot overwrite the payment made/received filter.

Individual ledger statements aggregate the whole filtered dataset and calculate chronological running balances in SQL before paging. Descending display reverses the rows without changing any row's balance. Date-range opening balances include earlier entries; text search does not alter that opening figure. Allocation details load only for visible documents and linked counterparts, while advances aggregate over the whole account. PDF/PNG requests load all matching entries explicitly. Stale read responses cannot replace a newer filter result.

Validation passed: `npm run check`, `npm run build`, the Singapore `npm run check:db` suite, all seven browser suites, and disposable financial/cache recovery checks. Read-action checks verified every page of nine real restored histories, including 1,786 stock movements before the fresh financial fixtures. Synthetic SQL checks cover 801 grouped records, an unsplit 130-record group, 501 ledger entries, empty results, literal search parameters, clamped pages, date filters, cancellation visibility and balances independent of display order. The new browser statement fixture verifies 100/100/25-row pages, off-page search, stale-response rejection and a complete 225-entry export. No additional Supabase migration or paid dependency was introduced.

The local restore's platform-owned `rls_auto_enable()` function has different default ACLs from hosted Supabase, so its platform security preflight is not a substitute for the live check. The live Singapore security check passed (40 relations, one sequence, three routines). Business-query and financial recovery tests ran against the disposable restore; all production database checks also passed.
