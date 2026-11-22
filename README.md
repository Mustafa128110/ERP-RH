# Royal Hardware ERP

Inventory, sales, purchases, stock and ledgers for Royal Hardware, with shared
sales channels managed in Settings. Channels follow sales, payments, purchases,
stock documents and quotation conversions. Contacts and the physical catalogue
are shared by the one company.

The Stock workspace combines products, quantities, rates, transfers and
adjustments. Old inventory URLs redirect there. Role setup offers access levels
and presets; an assigned role automatically provides single-company membership
without granting permissions the role does not contain.

Each contact appears once in Ledgers, with a chooser for its Settings channels.
Complete ledgers can be combined into a destination ledger, retaining all their
transactions and payment allocations. Closing posts a visible balancing adjustment,
retains history and actual cash, and starts a fresh settlement period in the same
ledger. Closed figures are retained; corrections use a new balance adjustment.

Stock Conversions consume one or more products and produce other products in
the same warehouse, preserving recorded FIFO cost. Outputs can be new SKUs with
their own base units and selling rates. Reports → Profit opens historical months
and their daily results, including returns, expenses and closing adjustments.
Table sorts accumulate priorities (newest first); sales invoices start by number.

## Company consolidation and recovery

Migration `0075_single_company_channels` consolidates M52 into Royal Hardware.
Matching products are merged only after identity, base-unit and rule validation.
Original company ownership and merged master records remain in the private
`consolidation_history` table. Financial documents, movements, account balances
and recorded allocations are preserved. Existing saved creates resolve former
company/product IDs; stale edits retain revision checks.

Before applying it, create and restore-verify a fresh encrypted local backup.
`scripts/consolidate-company.mjs --local <backup-folder>` rehearses the exact
migration against that restored copy and checks complete financial fingerprints,
stock quantities and valuations. Only then can `--apply <backup-folder>` apply
the same migration to the expected production project. It rolls back if a
preservation assertion fails and writes its verification report beside the backup.

Migration `0076_channel_ledgers_stock_conversion` follows the same procedure with
`scripts/apply-channel-ledgers.mjs --local|--apply <backup-folder>`. It checks full
financial fingerprints before committing and preserves every existing posting.
Run the database checks against the isolated rehearsal database before applying.

`scripts/create-portable-backup.mjs` copies all public ERP, authentication and
migration-history tables in one consistent read snapshot into a local clone,
checks every row digest, and creates an encrypted PostgreSQL recovery archive.
The clone template must match the current schema exactly; select a verified
template with `BACKUP_TEMPLATE_DATABASE`. `scripts/verify-backup-restore.mjs`
restores the archive into a new loopback database and checks every table again.
Backups stay local; source/configuration recovery archives include `.env` and
must remain encrypted. Provider services need provisioning during recovery.

`npm run check:single-company:browser` checks real UI components with isolated
fixture actions, including global column sizing and complete A4 ledger exports.
Set `PLAYWRIGHT_MODULE` / `ERP_BROWSER_EXECUTABLE` to an available browser runtime.

## Architecture

The app is a single Next.js (App Router) codebase deployed in two halves:

- **Frontend + Server Actions → Vercel.** The Next.js app, including all
  backend logic (`lib/actions/*` Server Actions, `lib/queries/*`, `lib/db/*`),
  runs on Vercel's serverless runtime.
- **Database + Auth + Edge Functions → Supabase.** Postgres holds the data
  (`supabase/migrations/`, mirrored from `drizzle/`), Supabase Auth handles
  sessions, and `supabase/functions/` is the home for any edge functions.

The server actions already talk to Supabase Postgres directly
(`DATABASE_URL_DIRECT`) and authenticate through Supabase Auth
(`@supabase/ssr`, `proxy.ts`). See `supabase/README.md` for the full split.

## Development

```bash
npm install
cp .env.example .env        # fill in the four Supabase variables (.env.example lists them all)
npm run dev
```

The app is also a PWA: `public/sw.js` + `public/manifest.json` give an offline
app shell (pages render from cache when the network drops), and the document
and batch-entry forms keep drafts (`lib/draft.ts`) so typed work is never lost
across reloads or offline sessions.

Database changes use drizzle (the source of truth):

```bash
npm run db:generate         # write a new migration from lib/db/schema.ts
npm run db:migrate          # apply migrations
npm run db:seed-rbac        # seed roles & permissions (fresh DB)
npm run db:seed-admin       # seed companies, admin user, sample data
```

## Checks

```bash
npm run check               # typecheck + lint + offline checks (no DB)
npm run check:db            # checks that need a live database (.env)
```

## Deployment

### Vercel (frontend + server actions)

1. Import the repo into Vercel.
2. Set every variable from `.env.example` in Environment Variables (Production
   + Preview) — exactly four: `DATABASE_URL_DIRECT`, `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. These are the
   only variables the codebase reads (no WhatsApp, Google Drive, or cron keys).
3. Deploy. No build step beyond `next build`. The auth middleware (`proxy.ts`)
   exempts `manifest.json`/`sw.js`, so the PWA metadata is reachable pre-login.

### Supabase (database + auth + edge functions)

1. Create a Supabase project.
2. Enable Email/Password auth, disable public signup (internal tool — admins
   are provisioned via `npm run db:seed-admin`).
3. Link and migrate:
   ```bash
   supabase link --project-ref <ref>
   supabase db push
   npm run db:seed-rbac
   npm run db:seed-admin
   ```
4. Edge functions: `supabase functions deploy <name>` (see
   `supabase/functions/README.md`).

### Keeping migration histories in sync

`drizzle/` is authoritative for development; `supabase/migrations/` mirrors it
for `supabase db push`. Copy new drizzle migrations across after
`npm run db:generate` (steps in `supabase/README.md`).
