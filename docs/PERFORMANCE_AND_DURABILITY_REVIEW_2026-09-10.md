# ERP performance and durability review — 10 September 2026

The best route is to repair the existing caching and recovery mechanisms, then let the interface respond from locally stored work while the existing server actions validate and commit it. A rewrite or paid performance service is not the first step.

Interpret “100% faster” as twice the speed: halve the time for the same task under the same conditions. This is a target to benchmark, not a result established by this review. Immediate visual feedback and a completed database transaction are separate events. The interface must distinguish **Saving on this device**, **Pending sync**, **Saved to server**, and **Needs attention**.

Literal zero data loss under every possible failure, instant remote confirmation, and zero operating cost cannot all be guaranteed. We can eliminate the specific loss paths below and test recovery from network failures, reloads, duplicate submissions, concurrent edits, and storage failures. Browser storage alone cannot survive destruction of its device or deliberate clearing of site data.

## Scope and evidence

Repository-wide inventory and TypeScript syntax-tree scan covered 366 source/check/script files: 43 page routes, 105 component files, 191 library files, 18 scripts, and the service worker, totaling 56,278 lines including comments and checks. Detailed inspection concentrated on shared infrastructure and the critical sales, purchases, payments, expenses, inventory, ledger, reporting, master-data, auth, WhatsApp, and backup paths. Migration parity checks covered 73 migrations. This is a broad architectural review with targeted reproductions, not a claim that every line or deployed workflow has been independently proven correct.

Read the installed Next.js documentation for offline support and router stale times. Historical 170 ms database timings in source comments were not treated as current measurements. No production writes, deployment, database migration, or hosting changes were made. Production regions, actual Redis hit rates, current database plans, backup execution history, and browser performance percentiles remain unverified.

**Validation:** typechecking, linting, tax checks, and unit-workflow checks passed. `npm run check` failed at `lib/performance-invariants.check.ts:25`, which expects `groupBy(documentLines.itemId, documentLines.unitId)` in the products action. Ran the remaining offline checks and WhatsApp check separately; those passed. Overall: 42 of 43 offline commands passed, along with the three other check commands. The full check command remains red. Do not remove the assertion simply to obtain green checks; reconcile it with the intended product stock calculation.

## Repair these durability gaps first

| Priority | Finding and evidence | Required change |
|---|---|---|
| P0 | Cancelling queued work removes the live entry before saving the archive, and ignores both persistence results. Restoring does the reverse with the same problem. [outbox.ts](D:/Projects/ERP/lib/outbox.ts:297) | Make the move atomic. Prefer a single IndexedDB transaction changing an entry's state. Until then, preserve the source unless the destination write succeeds and return failures to the UI. |
| P0 | `useDraft` writes initial form state even while offering an older draft for restoration. [useDraft.tsx](D:/Projects/ERP/components/ui/useDraft.tsx:66) | Preserve the recovery copy until Restore or Discard is resolved. A blank mount must never replace meaningful saved work. |
| P0 | Draft reads delete input older than 24 hours; malformed drafts are also deleted. [draft.ts](D:/Projects/ERP/lib/draft.ts:16) | Retain unsaved work until explicit disposal or confirmed save. Quarantine unreadable payloads for export/recovery instead of erasing them. |
| P0 | The server forgets operation IDs after 24 hours, while pending/failed outbox entries do not expire and cancelled entries can be restored for a month. [operation-id.ts](D:/Projects/ERP/lib/actions/operation-id.ts:68) | Retain operation receipts for the entire supported replay lifetime. With indefinitely replayable input, preserve a permanent compact operation identity or require explicit reconciliation before an expired operation can execute. |
| P0 | Normal form operation IDs are minted in component state, separately from drafts. Sale drafts omit the operation ID. Reloading and restoring after a lost successful response produces a new operation. [SaleForm.tsx](D:/Projects/ERP/components/modules/SaleForm.tsx:259) | Persist payload and operation ID together before sending. Reuse that ID after reload, timeout, retry, or deployment. Return the original committed result on replay. |
| P1 | Long-form draft protection is explicitly disabled for edits; several smaller forms have no draft hook. [useDraft.tsx](D:/Projects/ERP/components/ui/useDraft.tsx:31) | Recover edit drafts by record ID and base revision, with an explicit restore/conflict flow. Include all meaningful form fields, not just the controlled subset. |
| P1 | Queue contents are one localStorage array per user. A module-local drain flag does not coordinate separate tabs; concurrent read/modify/write operations can overwrite another tab's queue change. [outbox.ts](D:/Projects/ERP/lib/outbox.ts:100) | Store individual operations transactionally, use a cross-tab sync lease, and notify other tabs of changes. Server idempotency remains necessary even with a lease. |
| P1 | Sale updates lock posted rows but do not compare the version originally opened by the user. Locks serialize writes without detecting stale forms. [sales.ts](D:/Projects/ERP/lib/actions/sales.ts:801) | Add an expected revision to edits and atomically reject a mismatch before changing document lines, settlements, or stock. Preserve the rejected input and offer review of current values. Apply the same contract to batch edits. |
| P1 | `guard` calls connection resets/timeouts “Nothing was saved” based on error code alone, unlike the more careful connection retry helper. [guard.ts](D:/Projects/ERP/lib/actions/guard.ts:48) | A lost connection after commit has an unknown result. Say “Checking save status” and resolve by operation ID; only claim rollback when it is established. |

These are code defects or specific failure risks; they are not evidence that production records have already been lost.

**Local reproductions, using actual source transpiled in an isolated VM and in-memory storage:**

- Draft expiry: a 25-hour-old draft returned `null` and its raw storage entry was deleted.
- Draft mount: invoking the actual hook with controlled React hook stubs offered the old draft, then its scheduled save effect persisted the new empty state. This isolates the effect's behavior; it is not a browser end-to-end test.
- Queue cancellation: with the live removal succeeding and archive persistence returning `false`, `cancelOutboxEntry` returned a successful-looking entry while both stores contained zero copies.

## Where the speed can come from

**1. Fix the shared cache before adding more caching.**

[cache.ts](D:/Projects/ERP/lib/cache.ts:82) constructs Redis with default automatic deserialization. A Redis GET of a JSON object therefore returns an object, but the app calls `JSON.parse` again and treats the exception as a cache miss. Reproduced this with the installed Redis SDK and an injected requester, with no network: `sdkReturnedType = object`, `appSecondParse = throws`. Arrays have the same general mismatch. A warm in-process entry can still work; this does not mean every read misses.

There is a second defect to fix at the same time: [session.ts](D:/Projects/ERP/lib/auth/session.ts:104) caches a shaped session containing `Set` and `Map`. JSON serialization turns those into `{}`. Correcting only the extra parse would expose invalid session objects on shared-cache reads. Cache a JSON-safe session row and reconstruct permission collections after reading. Define serialization for dates and other non-JSON values across all cached lookups, bump the cache namespace, and verify a cold second process.

Each cached call also awaits version retrieval before checking its in-process value. Batch/deduplicate version checks within a request, avoid redundant lookup calls, and measure cache-command count and latency. Preserve shared invalidation; bypassing it for local speed would trade correctness for apparent performance.

Failed invalidation is another gap: the need to advance the shared epoch is only remembered in the failing process. Another healthy instance can continue using the old generation; a terminated writer may never repair it. Introduce a database revision or invalidation event recorded in the same transaction as the write, then deliver invalidation with retry. Critical decisions must continue reading the database. Do not describe Redis failure as globally guaranteeing fresh reads.

Without Redis, production deliberately bypasses the in-process cache. Preserve that safe fallback until there is another reliable multi-instance invalidation mechanism.

**2. Make lists and pickers scale without hiding records.**

[DataTable.tsx](D:/Projects/ERP/components/ui/DataTable.tsx:485) renders every matching row. [ComboBox.tsx](D:/Projects/ERP/components/ui/ComboBox.tsx:37) filters its options on each render, including while closed, and renders every match when opened. On a long entry grid, repeated picker work and whole-form synchronous draft serialization can compete with typing.

Use virtual scrolling inside the existing DataTable, preserving continuous access to every result, row numbers, keyboard navigation, selection, and DetailHover. Index picker labels once, compute results for the active picker, render only the visible option window, and profile memoized grid rows. Keep urgent text input separate from expensive search/render work.

The existing [all-rows check](D:/Projects/ERP/lib/data-table.check.ts:6) intentionally prohibits silent truncation and pagination controls. Preserve that user-facing requirement; update the test to prove reachability and correct selection across virtualized rows rather than requiring every row in the DOM. Do not replace the table with an arbitrary first-100-records limit.

For growing transaction histories, load bounded chunks behind continuous scrolling. Search and sorting must cover the full authorized dataset on the server; totals and exports must not accidentally cover only the loaded chunk.

**3. Load summaries before complete edit forms and every line item.**

[listSales](D:/Projects/ERP/lib/actions/sales.ts:81) fetches all matching documents and their line items without a limit. Its line query does not apply the customer-name filter, so a customer search still reads unrelated lines within the other scope filters. [The invoice page](<D:/Projects/ERP/app/(dashboard)/sales/invoices/page.tsx:31>) also waits for all sale-form options before rendering the list, then calculates status filtering and totals in JavaScript.

Return lightweight list summaries and SQL totals first. Query lines for the selected document chunk or on hover/open. Preserve item/unit searches with SQL predicates instead of transferring all lines solely for searching. Fetch edit-only options on intent or dialog open and reuse scoped option snapshots. Apply the same review to purchases, payments, contacts, products, stock, and ledger screens. Keep small master lists simple.

**4. Reduce database round trips while preserving transactions.**

The app already batches many writes and uses a two-connection pool. Six dashboard queries in `Promise.all` still compete for those two connections; concurrency syntax does not make them six simultaneous database executions. [Dashboard aggregation](D:/Projects/ERP/lib/actions/dashboard.ts:88) can combine independent totals in one statement and aggregate stock summaries in SQL.

[Sale creation](D:/Projects/ERP/lib/actions/sales.ts:565) still has sequential document-type/location reads, followed by multiple dependent transaction statements, invalidation, and audit work. Combine independent reads; consider a carefully checked SQL statement/function for cohesive posting work only after profiling. Preserve authorization, atomic stock/ledger/settlement changes, numbering, guard behavior, and auditing.

Measure query execution time separately from connection/transport time. Inspect `EXPLAIN (ANALYZE, BUFFERS)` for read queries with realistic data before adding indexes. Composite document/date and line/item indexes already exist. Do not blindly increase the connection pool or replace the prepared-query wrapper: both have deployment-specific constraints.

Verify that production compute, database, and Redis are geographically close. The repository does not pin a function region; dashboard configuration may already do so. This review does not establish a deployment mismatch. [Vercel documents the effect of function/data-source distance](https://vercel.com/docs/functions/configuring-functions/region).

**5. Extend immediate interaction to new records safely.**

[useOptimisticRecords](D:/Projects/ERP/lib/use-optimistic-records.ts:10) already supports optimistic edits/deletes, but inserts are added after the server returns IDs. The durable queue supports only quotation, expense, and payment operations. Next's experimental offline retries keep a request pending in the current page; they are not a durable operation journal surviving tab closure.

Use one persisted command format for both online and offline submissions. On Save, validate locally, durably record the user's command, then show it as pending and allow work to continue. Sync through the existing server actions. Replace the pending entry with the canonical committed result. Rejections keep the original input available for correction.

Stock, balances, invoice numbers, and final calculated totals remain server-authoritative. A pending entry represents real user input, visibly unconfirmed. Never issue a final invoice or imply stock is reserved solely because the browser has accepted a command. Queue stock-sensitive operations only as pending intent, validating current stock and permissions when they execute.

**6. Make freshness explicit.**

The router uses 60-second dynamic and 180-second static stale times. Intent-prefetched routes use the static setting even when their data is dynamic, as the [installed staleTimes guide](D:/Projects/ERP/node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/staleTimes.md) explains. Open pages and warm detail maps have no cross-user push invalidation; an idle open view is not automatically refreshed just because a TTL passes.

Give detail entries a revision/expiry, reconcile on focus and reconnect, and use scoped revision checks where multiple users need fresher views. Do not poll every table continuously. Permission revocation and company changes must invalidate every relevant local snapshot. [client-cache.ts](D:/Projects/ERP/lib/client-cache.ts:112) also treats a genuinely empty live option list as permission to reuse old cached options; distinguish “loaded and empty” from “unavailable offline.”

## Durable command contract

Persist an operation ID, payload version, action kind, user/company scope, target record ID, expected record revision, creation time, and canonical payload together. The database receipt should bind that identity to the actor, operation kind, payload hash, committed record IDs, and result. Reject reuse of an ID for a different payload. A retry of the same committed command returns the original result.

Use IndexedDB transactions for draft/outbox state and migrations that preserve older payloads. Retain a copy until the server outcome is reconciled. Guard synchronization with a cross-tab lease, handle quota failures explicitly, and provide export for unrecoverable or unsynced work. A local storage acknowledgment must only be displayed after the transaction completes.

IndexedDB is asynchronous, whereas localStorage is synchronous; this helps larger grids avoid blocking input. Persistence requests can reduce automatic eviction but do not protect against user deletion or device loss. See [MDN Web Storage](https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API) and [storage persistence limits](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria).

Keep `recordAudit()` as required. It is currently best-effort and runs after the business write, so it is not a complete recovery journal. A durable operation receipt or audit event should be committed transactionally if recovery depends on it; logging or delivery can follow afterward.

WhatsApp needs the same distinction: `takePending()` atomically consumes a draft before `commitDraft()`. A process failure in between loses that pending intent. Preserve the existing “yes” requirement and atomic claim, but use a recoverable processing state/lease backed by the durable command receipt for critical posting.

## Backups and the meaning of “free”

The current [backup workflow](D:/Projects/ERP/.github/workflows/database-backup.yml:5) runs at 15:00 and 20:30 Pakistan time and retains only `latest.zip`. Even if every run succeeds on time, the longer interval is **18.5 hours**. A backup-only recovery can lose changes since the last successful snapshot; a missed run makes that window longer. One retained copy also cannot recover from corruption noticed after a bad state replaces a good backup.

Three separate pg_dump invocations export roles, schema, and other data. They do not share one snapshot, so concurrent changes can produce a mismatched bundle. Prefer one consistent custom-format dump, or explicitly share an exported snapshot. Verify restoration order, hosted-auth dependencies, and any external stored files. PostgreSQL documents consistent dumps and synchronized snapshots in [pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html).

Keep the existing encrypted upload and verification, strengthen restore verification with ledger/stock/numbering reconciliation, and verify only into a disposable database. The current single-archive policy is deliberate in repository documentation; a versioned retention policy is a proposed policy change, not something changed by this review. Size a retained history and an independent copy against actual free allowances. A full journal or replication strategy is required for a much smaller disaster-recovery loss window; ordinary periodic backups do not provide zero-loss disaster recovery.

| Cost area | Practical conclusion |
|---|---|
| Code improvements | Can use the existing framework, database, and browser APIs, with no new paid service. Implementation and maintenance still take time. |
| Existing hosting | Account plan was not inspected. Vercel Hobby is restricted to personal/non-commercial use, so it is not a supported free hosting basis for a business ERP. [Vercel plan rules](https://vercel.com/docs/plans/hobby) |
| Shared cache | Upstash currently lists 256 MB and 500,000 commands/month in its free tier. Measure version checks, lookups, invalidations, and WhatsApp usage together. [Upstash pricing](https://upstash.com/pricing/redis) |
| Backups | R2 Standard includes 10 GB-month storage, 1 million Class A operations, and 10 million Class B operations per month. Retention must fit actual allowance and CI capacity; exceeding allowances can cost money. [R2 pricing](https://developers.cloudflare.com/r2/pricing/) |
| Database recovery | Supabase recommends off-site exports for free-tier projects; automated backup/PITR capabilities must not be assumed free. [Supabase backups](https://supabase.com/docs/guides/platform/backups) |
| Entire stack without subscriptions | Running on already-owned hardware is an option to evaluate if subscriptions are prohibited. Electricity, internet, maintenance, independent backups, and hardware failure remain costs and operational responsibilities. This is not a migration recommendation without measuring the current deployment first. |

## Delivery order and acceptance criteria

1. **Establish the baseline and repair recovery:** reproduce the defects as runnable checks; fix draft preservation, cancellation/restoration atomicity, persistent operation IDs, and replay retention. Resolve the existing failing performance assertion. Record cold/warm production-build navigation, typing, edit open, and save-confirmation times on the shop's actual hardware.
2. **Repair cache correctness and reduce payloads:** fix the JSON codec and session shape together, add cross-instance cache tests, combine edit-detail reads, and remove unnecessary list/form/line loading. Measure actual region and connection behavior.
3. **Improve large-screen interaction:** add virtual scrolling and efficient picker/grid rendering while preserving all-results access and keyboard behavior. Move durable storage off synchronous whole-array writes.
4. **Expand immediate saves:** introduce the persisted command path, versioned edits, canonical replay responses, and visible pending/error states. Extend to more financial workflows only with server-side validation and recovery checks.
5. **Prove recovery and deploy incrementally:** verify backups in a disposable database, test interrupted sync and multi-user conflicts, and release one workflow at a time with backward-compatible stored payloads and schema changes.

Suggested targets, not measured results: visible acknowledgment within 100 ms on the target device; normal typing/selection within 100 ms; at least a 50% reduction in median and p95 completion time for specifically selected slow workflows relative to baseline. Track local persistence time and server confirmation time separately. Slow hardware or storage errors must produce an honest pending/failure state rather than a false success to meet a timer.

Required recovery scenarios: close/reopen before sync; lose the response after commit; replay after more than 24 hours and across deployment; storage quota failure during enqueue/cancel/restore; two tabs enqueuing simultaneously; two users editing the same record; permission revocation before sync; cache invalidation failure on another instance; and full restoration with stock, ledger, balances, and document numbers reconciled. “Zero loss” should refer to the tested failure envelope and explicitly acknowledged writes, not an unlimited promise.
