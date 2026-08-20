# Production verification runbook — offline system, cache authority, recovery

This runbook proves the offline system against the **deployed** application. It
exists because localhost cannot: the dev server has no service worker, so
offline *navigation* is only provable in production.

Two parts:

- **§1–§2 — automated harness** (`scripts/verify-production.mjs`): everything a
  browser + optional database access can prove on its own.
- **§3–§9 — manual phases**: OS-level disconnects, browser close/reopen,
  first-visit readiness, storage failure, service-worker deployment update,
  and the backup/restore drill. Each has exact instructions.

Everything below is deliberately non-destructive: the only records the harness
creates land in a company you name (`UI_TEST_COMPANY`), carry unique markers,
and are either deleted afterwards or left identifiable as test data (committed
financial history must never be deleted — see §10).

---

## 0. Prerequisites and deployment record

1. Deploy the current commit (`git rev-parse HEAD` → record it), verify the
   build succeeded, auth works, the app shell loads and the service worker
   installs (DevTools → Application → Service Workers shows `sw.js` active).
2. A test user (admin) and, for the isolation phase, a second user. Neither
   should be a real person's account.
3. A **test company** — a company created solely for this verification. Every
   record the harness creates lands there. If the deployment has no such
   company, create one (Settings → Companies) and give the test user access.
4. Chrome running with `--remote-debugging-port=9222` (same as the other
   `scripts/verify-*.mjs` scripts).
5. Environment (set in `.env`, never committed):

   ```bash
   PROD_URL=https://<your-deployment>   # no trailing slash
   UI_TEST_EMAIL=<test user>
   UI_TEST_PASSWORD=<password>
   UI_TEST_EMAIL2=<second user>         # isolation phase
   UI_TEST_PASSWORD2=<password2>
   UI_TEST_COMPANY=<substring of the test company's name>
   DATABASE_URL_DIRECT=postgresql://... # optional: enables the DB exactly-once phase
   ```

---

## 1. Test A — establish online state (automated)

The harness does this before anything else: log in, then visit the dashboard,
quotations, expenses and payments **online** so the service worker caches the
pages and the offline-readiness prep seeds the reference cache.

## 2. Automated walkthrough

```bash
node --env-file=.env scripts/verify-production.mjs
```

Phases (each logs `== name ==` and `✓`/`FAIL`):

| Phase | Proves | Notes |
|---|---|---|
| `login` | production login works | |
| `sw` | the deployed shell installs `sw.js` | |
| `readiness` | all 8 reference kinds are cached **without** visiting the workflow pages | first-visit proof, see §4 for the manual repeat |
| `offline-queue` | quotation + expense + payment queue offline, **zero server POSTs**, all PENDING | requires `UI_TEST_COMPANY`; refuses to queue elsewhere |
| `offline-reload` | reload while offline serves the SW shell; the three entries survive | |
| `reconnect` | reconnect drains all three; pill clears | |
| `db-exactly-once` | each of the three is exactly one logical transaction in the database | skipped without `DATABASE_URL_DIRECT` |
| `lost-response` | a committed save whose response is dropped shows the transport error; the replay is refused as `already recorded`; DB has exactly one | live quotation form, Fetch interception |
| `permanent-failure` | a queued entry the server refuses becomes **FAILED** with a visible reason — never disappears | entry injected with a blank company, so nothing is written |
| `cancel-restore` | cancel is two-click, payload kept in the per-user archive; restore reuses the **same operation id**; delete forever is two-click | |
| `logout-isolation` | logout with pending work warns and does not lose it; user B sees none of user A's local data; user A's work returns | user-B half skipped without `UI_TEST_EMAIL2` |

Skip any phase with `SKIP=phase1,phase2 node --env-file=.env scripts/verify-production.mjs`.

The script writes `/tmp/erp-production.json` (marker, phases run, network/
exception issues) and exits non-zero on any failure.

### Phase M (transient failure) — automated

The offline-queue → reconnect cycle *is* the transient-failure test: the queue
survives a network bounce and the drain retries. For a mid-drain interruption
(server erroring 50x, not a network drop), do the manual variant: run the
harness with `SKIP=offline-reload,db-exactly-once`, and while `reconnect` is
draining, disconnect the machine. On reconnect the drain resumes from where it
stopped; the entries are never lost and never duplicated (operation ids make a
re-send safe).

## 3. Manual — offline reload with the OS network actually off

CDP network emulation is close, but the runbook's requirement is to *actually*
block the network. Repeat phases `offline-queue` + `offline-reload` with the
real disconnect:

1. Run the harness once (leaves nothing behind except its markers — optional).
2. Manually: log in, visit dashboard / quotations / expenses / payments, wait
   for the pill to show nothing (online, ready).
3. **Disable the OS network** (airplane mode, unplug, or firewall rule).
4. Reload the ERP. Expected: the app shell loads, the pill reads
   `Offline — ready` or `Offline — limited`, and the pages you visited remain
   navigable. A browser network-error page is a FAIL.
5. Close the browser entirely, reopen it, and navigate to the production URL
   while still offline. The shell must load again.
6. Re-enable the network and confirm the pill clears.

## 4. Manual — first-visit offline readiness

The exact §9 proof that readiness is proactive, not page-visit caching:

1. DevTools → Application → Clear site data (or a fresh browser profile).
2. Log in **online**. Do **not** visit quotation / expense / payment pages.
3. Wait until the pill no longer reads `Preparing offline data…` and then
   disappears (online + ready = invisible). Optionally open the pill tray to
   read the readiness text.
4. Disconnect the network. Open **Quotations**, **Expenses**, **Payments**.
   Expected: every required picker (companies, customers, items, units,
   expense categories, contacts, bank/cash accounts, cheques) is populated
   from the cache — no empty dropdowns, no error boundary.
5. Queue one record in each to confirm the forms are fully usable offline.

## 5. Manual — storage failure in a real browser

Engine-level failure behavior is checked by `lib/outbox.check.ts`; this proves
it in the browser:

1. **Write failure**: DevTools → Rendering → disable `localStorage` (or fill
   the quota by writing a large value from the console until `setItem`
   throws). Fill a quotation and click *Queue for later*. Expected: the form
   stays open with its rows, a warning appears (the tray's storage warning),
   and nothing claims the work is safely stored. **Do not close the page.**
2. **Corrupt outbox**: from the console, overwrite the `erp-outbox:<uid>` key
   with `not json at all{{`, then reload. Expected: the tray shows the
   "couldn't be read … kept under a backup key" warning and the raw bytes
   exist under `erp-outbox:<uid>:corrupt-*`.
3. **Corrupt cache**: overwrite an `erp-cache:v1:<uid>:companies` value with
   garbage and reload. Expected: readiness reads `limited` (the corrupt kind is
   missing), the forms fall back to live options online, and no crash.

## 6. Manual — logout / user isolation without a second user

If `UI_TEST_EMAIL2` is unavailable:

1. Log in as user A, queue a record offline (or inject one via the console —
   see the harness's `logout-isolation` phase).
2. Click **Log out**. Expected: the button arms (`Log out anyway?`) with the
   "N operations are waiting to sync" note. One click never logs out silently
   with pending work.
3. Confirm, log back in as A. The pending entry is still in the tray.
4. To prove B cannot see it: log out, log in as B, and check the console —
   `Object.keys(localStorage).filter(k => k.startsWith('erp-'))` must be empty.
   All local persistence is keyed per user id (`erp-*:<uid>`), so B's browser
   state starts clean; A's returns on A's next login.

## 7. Manual — backup capability, automated-backup gap, restore drill

### 7a. Establish the facts (no assumptions)

The application itself has **no full-database backup path**: its Backups screen
(`lib/actions/backups.ts`) offers CSV exports of the business tables and says
so plainly — "Nothing running inside a Next server can take a consistent dump
of the database it is connected to." The database is **Supabase Postgres**
(`supabase/README.md`).

Record the actual platform facts from the Supabase dashboard
(**Database → Backups** for the project in question):

| Question | Where to look |
|---|---|
| Plan (Free / Pro / Team / Enterprise) | Dashboard → Project Settings → Billing |
| Automated backups on/off, frequency | Database → Backups |
| Retention | Database → Backups |
| Point-in-time recovery (PITR) available | Database → Backups → PITR |
| Manual dump mechanism | `supabase db dump` / `pg_dump` (§7c) |

Then fill in §8's RPO/RTO honestly — if any of these are unverified, they are
**UNDEFINED**, not assumed.

### 7b. Automated-backup gap

If the plan has no dependable automated backup, the two compatible options
(do not add both):

1. **Supabase Pro built-in daily backups + the PITR add-on** — paid (identified
   explicitly), native, off-site, with retention and point-in-time restore in
   the dashboard. This is the recommended option if the business tolerates the
   cost.
2. **Free scheduled `pg_dump`** — a scheduled GitHub Action that dumps the
   database to a private repository's release or an object-storage bucket.
   Sketch (credentials are GitHub secrets, never source):

   ```yaml
   # .github/workflows/db-backup.yml (free tier: 21-day artifact retention)
   on:
     schedule: [{ cron: "0 3 * * *" }]   # daily 03:00 UTC
   jobs:
     dump:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - run: |
             pg_dump "$DATABASE_URL_DIRECT" -Fc -f erp-$(date +%F).dump
             ls -la erp-*.dump
         - uses: actions/upload-artifact@v4
           with: { name: erp-db, path: erp-*.dump, retention-days: 30 }
       env:
         DATABASE_URL_DIRECT: ${{ secrets.DATABASE_URL_DIRECT }}
   ```

   Requirements checklist for whichever option: automated ✓, timestamped ✓,
   off-site from the primary database ✓, failure visible (backup job failure
   emails the repo owner) ✓, retention policy ✓, secrets protected ✓, restore
   procedure = §7c.

### 7c. Restore drill (never against production)

1. Take the backup/export: `pg_dump "$DATABASE_URL_DIRECT" -Fc -f erp-$(date +%F).dump`
   (or use the dashboard's Download Backup). Record timestamp, size, and
   `pg_dump`'s version.
2. Restore into an isolated scratch database — a fresh local
   (`supabase start` + `pg_restore -d postgres ... erp-*.dump`) or a throwaway
   Supabase project. Never restore over production.
3. Verify structure: tables, indexes, constraints, functions
   (`\dt`, `\di`, `\d <table>`, `\df`), and row counts against the source:
   `select count(*) from items, contacts, documents, document_lines,
   inventory_transactions, ledger_entries, payments, expenses, cheques, ...`.
4. Verify representative relationships and totals: a known document's lines,
   the ledger's debits=credits per company, stock-on-hand for a known item,
   the audit trail for a known record.
5. Run the existing DB checks against the restored copy where the connection
   string can be pointed at it (`npm run check:db` with `DATABASE_URL_DIRECT`
   set to the scratch database — **careful**: the checks are read-only, but
   point them at the scratch DB, never at production).
6. Record the result as PASS / FAIL / NOT POSSIBLE with the exact blocker.

## 8. Manual — service-worker update across a deployment

1. With a pending outbox entry and a draft on screen, deploy the next harmless
   commit (a wording change is enough) and record both hashes.
2. Revisit the app (a normal reload — the SW uses `skipWaiting` and
   `clients.claim`, so the new version takes over on the next load).
3. Verify: the new application loads (not the old shell forever), the pending
   entry, failed entry, cancelled archive and draft all survived, and the
   reference cache was rebuilt (its key is versioned — `erp-cache:v1:` — so an
   incompatible shape cannot be served after a deployment; drafts and the
   outbox are deliberately unversioned and are never auto-invalidated by a
   deployment).
4. DevTools → Application → Service Workers: confirm the old SW is gone and the
   new one is active.

## 9. Performance evidence — Speed Insights + controlled runs

- **Real users**: Vercel Speed Insights is already installed (root layout).
  After the deployment has traffic, record LCP / INP / CLS / TTFB and the
  slowest routes from the Vercel dashboard (Analytics → Speed Insights). If
  traffic is too low for statistically useful numbers, say so — do not
  fabricate.
- **Controlled**: with DevTools open (Network tab, throttling off), time the
  target flows — dashboard, inventory, product search, customer lookup,
  supplier lookup, sales, purchases, ledger, invoice list/detail, quotation,
  expense, payment — measuring NAVIGATION→usable UI, CLICK→visible reaction,
  SUBMIT→acknowledgement. Record request counts and largest chunks.
- **Build**: `npm run build`, then compare the emitted per-route chunks with the
  previous stage's baseline (PDF/print code must remain lazy-loaded; the
  offline/readiness code should not have grown the critical shell materially).

## 10. Cleanup and test-data policy

- The harness's records carry markers `PQC-`/`PEC-`/`POC-`/`PLR-`/`PLI-` +
  timestamp. Quotations can be deleted from the UI after the run.
- Committed expenses/payments are financial history — **never delete** them;
  leave them in the test company, identifiable by marker.
- The injected `PERM-FAIL-*` and `LOGOUT-*` outbox entries are removed by the
  harness itself (cancel→delete, and the cleanup step).
- If a run failed mid-way, re-running starts by wiping `erp-*` local keys for
  the test user (the harness does this after login) — server-side records from
  the failed run remain in the test company under their markers.

## 11. Reporting

Run every phase, then fill the stage report from the results file
(`/tmp/erp-production.json`) plus the manual notes. For every scenario report
PASS / FAIL / NOT TESTABLE with evidence, and map them to the final report
sections (production offline, offline readiness, outbox durability, identity
isolation, financial semantics, storage failure, backup/restore with RPO/RTO,
performance with real numbers, bottlenecks P0–P3, changes, remaining risks).
