# Durable saves: implementation and rollout

Updated 2026-09-11 for the main-branch release. Migration 0073 is applied and registered on **ERP-System (Singapore)** (`gvneuhadkktmhoxaazzg`, `ap-southeast-1`). The application release targets the existing Vercel project `erp-rh` and `erp.royalhardware.co`.

Release inspection found the previous application functions in `iad1` while Supabase runs in Singapore. `vercel.json` now selects `sin1` to put application queries near their database. This uses a single region; no additional service was introduced. See [Vercel region configuration](https://vercel.com/docs/functions/configuring-functions/region).

The latest pre-release backup run verified successful was GitHub Actions run `34515220140` (2026-09-10). Existing schema evidence confirms earlier migrations were applied outside Supabase's journal; entries 0066–0072 remain unreconciled. Only 0073 was applied for this release, then registered as `20260910000073`. Do not use an unrestricted migration replay to repair historical metadata. The first migration runner reported a connection cleanup error after its transaction committed; schema inspection confirmed success, and the database proxy's callable `$client` properties were repaired and regression-checked before application release.

## Implemented behavior

Save first commits the submitted input and a permanent operation ID to IndexedDB. Only after that transaction completes does the UI acknowledge it and let the existing form reset/close behavior proceed. New sales clear for the next sale. Pending work appears in a shared panel on dashboard pages immediately, including its submitted fields and synchronization status. It is separate from the server-confirmed invoice list: official numbers, printable invoices, stock, and balances require server confirmation.

The queue survives reload and disconnection in the same browser profile. It retries on reconnect, focus, and a five-second timer while the app is open. A closed browser does not continue running this worker; reopening the app under the same account resumes it. Concurrent tabs share an IndexedDB lease. A lost response is retried using the same command ID. The database receipt, business writes, and audit writes share one transaction, so a committed replay returns the original result without repeating the operation.

Validation refusals retain their input for review, correction, retry, or cancellation. Cancellation of never-sent or definitively refused work is an atomic state change; an ambiguous timeout cannot be cancelled as if the server did nothing. Archived input is recoverable until explicitly discarded. Failed/unconfirmed work and storage failures trigger the browser's refresh/close warning. Browsers control this generic dialog and may suppress it without prior interaction or on mobile termination; durability does not depend on the warning appearing.

The generated action adapters cover 24 database action modules: accounts, brands, categories, companies, contacts, expenses, inter-company, ledger, locations, market-purchases, payments, products, purchases, quotations, returns, roles, sales, settings, stock-adjustments, stock-transfers, taxes, transfers, unit-conversions, and units. `lib/command-registry.ts` is the precise allowlist. Regenerate with `node scripts/generate-background-actions.mjs` when deliberately changing it.

Quick-add dialogs that must return a real foreign-key ID remain confirmed operations. Credential provisioning, external sending, backups, imports, and account/scope preferences retain their existing confirmed workflows. Do not describe those operations as locally completed background writes.

## Correctness and performance repairs

- Drafts no longer expire automatically or get overwritten by an initial blank mount. Malformed stored input is retained. Draft and command identities survive recovery. Editing an existing document no longer clears an unrelated create draft.
- Redis uses an explicit transport codec that preserves Date, Set, and Map, and disables SDK automatic deserialization. Session rows are shaped after cache retrieval. Client option snapshots are account-scoped; an authoritative empty list does not resurrect old options.
- Command writes bypass read caches for business validation. Detail reads capture record revisions; the executor locks and checks supplied revisions before mutating. An open editor retains its captured version when another hover loads the record.
- Large DataTables use virtual scrolling while retaining search, selection, keyboard navigation, mobile access, and full printing. Closed ComboBoxes avoid filtering their option lists.
- Sales customer/status filters also constrain line reads. The invoice list no longer loads all sale-form options before rendering; one edit read loads the selected sale and its options on intent. Warm invoice details expire after 30 seconds.
- Backup archive parts now come from one PostgreSQL snapshot, keeping the existing encrypted archive format.
- WhatsApp confirmation atomically moves a draft into recoverable working storage and uses the same command receipts and guarded actions. Drafts are only removed after acknowledgment; unknown outcomes retain the original operation identity.

## Validation

- `npm run check`: TypeScript, ESLint, tax/unit checks, offline checks, and WhatsApp matching.
- `npm run build`: production compilation and route generation.
- `scripts/check-durable-browser.mjs`: real Edge/IndexedDB commit acknowledgment, offline/reload, shared tabs, account isolation, duplicate identity, injected quota failure, native beforeunload dialog, draft restore, and edit revision capture.
- `scripts/check-table-browser.mjs`: 5,000 rows, initially 20 mounted; complete selection/search, End navigation, show-all, printing, and 390px mobile scrolling. This is a DOM scaling result, **not** a measured twofold whole-app speedup.
- `lib/command-receipt.db.check.ts`: actual PostgreSQL driver, canonical replay, actor/payload isolation, nested transactions and rollback/retry. Uses temporary tables and rolls its outer transaction back; it does not insert business records.
- `lib/whatsapp-agent/state.check.ts`: actual Redis, unique disposable test keys, confirmation replay, acknowledgment ownership, refusal recovery, and cancellation race. No customer messages or business actions are sent.

Run the browser checks with Playwright installed or `PLAYWRIGHT_MODULE` pointing to an available installation. `ERP_BROWSER_EXECUTABLE` optionally selects an installed Chromium browser. Run a build before the table check so it can load actual application CSS.

## Release order

1. For other environments, back up and verify the target first. Review the additive [migration](../drizzle/0073_durable_commands.sql) and its matching Supabase migration. Apply **only the new migration** through the repository's established migration process before deploying the new app. The Singapore project already has this migration. Its database has an out-of-band migration history; blindly replaying `db:migrate` can collide with existing objects.
2. The existing individual-file runner, when deliberately targeting the configured database, is `npx tsx --conditions=react-server --env-file=.env scripts/apply-migration.ts drizzle/0073_durable_commands.sql`. Verify the table, primary key, RLS, and denied browser-role access afterward. Do not rerun a successfully applied CREATE TABLE file.
3. Deploy the matching server and client code together. Preserve command receipts, submitted operation IDs, and version-1 payload handling across later releases. Do not remove the receipt table during an application rollback.
4. In a disposable/test company, verify sale, purchase, payment, expense, return, cancellation, transfer, batch master creation, and settlement confirmation from the actual UI. Interrupt the connection before request, during request, and after database commit; reconcile stock, ledger, payments, audit, and official numbers. Test current-role revocation before replay.
5. Run a backup/restore rehearsal in a disposable database. This change's backup workflow has been checked structurally; a new archive has not been generated and restored during this implementation.

## Remaining work and limits

The follow-up release extends recovery and revision checks to brands, units, taxes, warehouses, and companies. Their list queries carry the row version in the same SQL statement, and that version travels with queued edits/deletes. Native edit controls are saved per account and record; restore is explicit, stale or malformed drafts remain downloadable, and passwords/files/hidden controls are excluded. An update clears its draft only after IndexedDB commits; queueing a deletion retains any separate unsaved edit. Master batch dialogs retain their rows, except one-row quick-add dialogs that must return confirmed IDs. Browser recovery and temporary-table PostgreSQL conflict checks cover this extension. No new migration is needed.

This implementation does not establish literal zero data loss or a universal 100% speed gain. Browser-profile deletion, disk/device loss before synchronization, and database disaster recovery remain outside the verified queue failure scenarios. Browser persistence is requested, not guaranteed. No new paid service is required by these changes; existing hosting and database plan restrictions and quotas still apply.

The original review includes further work: revision capture and edit recovery on the remaining specialized screens; durable cross-instance cache invalidation after Redis failure; bounded server-side loading/search for growing histories; additional picker/grid profiling; SQL dashboard aggregation; real production latency baselines; and a verified backup recovery-point/retention policy. Current detail revision protection is not a universal multi-user edit guarantee. Failed Redis invalidation can leave another instance's display stale until TTL/recovery; command validation reads the database directly.

Confirmed browser commands currently retain their full input for recovery. Monitor local storage growth and design explicit, receipt-preserving compaction before long-running high-volume use. Do not expire unresolved commands or delete receipts to reclaim space.

The [repository review](PERFORMANCE_AND_DURABILITY_REVIEW_2026-09-10.md) records the baseline findings, rationale, and remaining performance investigation. Its descriptions of old behavior are baseline observations; this document records the implemented changes.
