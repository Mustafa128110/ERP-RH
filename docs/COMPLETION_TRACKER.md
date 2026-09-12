# Performance and durability completion

This tracks the remaining work requested after release ad36a3b. Existing rollout evidence is in DURABLE_SAVES_ROLLOUT.md.

- [x] Recovery coverage for remaining specialized forms and batch edits
- [x] Database-backed cache freshness across instances and Redis failures
- [ ] Bounded history loading and full-dataset search/sort/export
- [x] Picker/grid profiling and dashboard SQL aggregation
- [ ] Fresh encrypted backup, retained history, disposable restore verification
- [x] Financial workflow recovery, concurrency and permission-revocation tests
- [x] Confirmed queue compaction retaining unresolved input and operation receipts
- [x] Measured browser/query performance report
- [ ] Full checks, main push, Singapore migration/deployment and live verification

Any external prerequisite that cannot be completed will be recorded explicitly; unchecked items must not be described as finished.

2026-09-12: migration 0074 is applied and registered on Singapore. Full check, production build and six browser suites passed. Today's encrypted backup restored exactly: 38 public tables, 10,485 rows, all table fingerprints and constraints matched, and three auth identities restored. Hosted backup/restore workflow verification and application deployment are pending.

History pagination is complete for sales invoices and stock purchases, including full-history search/sort, totals, clamped page links and explicit full-match printing. Remaining history work: payments/expenses must page complete daily groups; quotations, transfers, adjustments, market purchases and ledger still need bounded loading. Ledger summaries and recent document hovers still fetch more source rows than they display. These are required follow-up work, not claimed complete by this release.

See PERFORMANCE_DURABILITY_VERIFICATION.md for scope, checks and measurements.
