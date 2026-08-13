# Royal Hardware ERP

Inventory, sales, purchases, stock and ledgers for Royal Hardware and M52.

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
