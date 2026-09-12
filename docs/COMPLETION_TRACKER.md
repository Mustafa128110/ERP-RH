# Performance and durability completion

This tracks the remaining work requested after release ad36a3b. Existing rollout evidence is in DURABLE_SAVES_ROLLOUT.md.

- [x] Recovery coverage for remaining specialized forms and batch edits
- [x] Database-backed cache freshness across instances and Redis failures
- [x] Bounded history loading and full-dataset search/sort/export
- [x] Picker/grid profiling and dashboard SQL aggregation
- [x] Fresh encrypted backup, retained history, disposable restore verification
- [x] Financial workflow recovery, concurrency and permission-revocation tests
- [x] Confirmed queue compaction retaining unresolved input and operation receipts
- [x] Measured browser/query performance report
- [x] Full checks, main push, Singapore migration/deployment and live verification

Any external prerequisite that cannot be completed will be recorded explicitly; unchecked items must not be described as finished.

2026-09-12: migration 0074 is applied and registered on Singapore. Full check, database checks, production build and six browser suites passed. Today's encrypted backup restored exactly: 38 public tables, 10,485 rows, all table fingerprints and constraints matched, and three auth identities restored. Main commit e208834 is live at erp.royalhardware.co with sin1 functions. Hosted backup run 34679302882 and disposable restore run 34679385602 passed. Follow-up commit f389268 deploys the ledger changes and compatible dependency security patches. Hosted quality run 34680166551 passed npm ci, all checks, the security audit and the production build. Deployment dpl_H2HY5ARqVBnwufUTUBXNNx6VXcM5 is Ready on the production alias with sin1 functions; the live login returned HTTP 200. The dependency audit reports zero vulnerabilities.

History pagination now covers sales invoices, stock purchases, payments, expenses, quotations, stock and cash transfers, inter-company sales, adjustments, market purchases and individual ledger statements. Payments and expenses page complete daily groups; market confirmations keep all their lines. Stock movements expose the complete history instead of stopping at 500 records. Search and sorting execute over all matches, with explicit all-match printing/export. Ledger summaries and running balances are calculated before paging; settlement details are fetched for visible documents and their linked counterparts. All agreed implementation items are complete.

Final history verification: full code checks and production build passed; seven browser suites passed; the Singapore database suite passed including security, scope, reports, cache generations and the new history tests. Restored-data action checks traverse every page of nine lists and compare ledger entries, allocation links, advances and summaries with the full result. Boundary tests cover 801 grouped records, a 130-record daily group, and a 501-entry statement. No new schema migration or paid service is required for this final history release.

See PERFORMANCE_DURABILITY_VERIFICATION.md for scope, checks and measurements.
