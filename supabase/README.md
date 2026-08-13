# `supabase/` — backend & edge functions

This is the Supabase side of the deployment split:

| Part            | Where it runs            | Lives in                                            |
| --------------- | ------------------------ | --------------------------------------------------- |
| Frontend (UI)   | **Vercel**               | `app/`, `components/` (the Next.js app, unchanged)  |
| Server Actions  | **Vercel** (Next.js)     | `lib/actions/`, `lib/queries/`, `lib/db/`            |
| Database        | **Supabase** (Postgres)  | `supabase/migrations/` (mirror of `drizzle/`)        |
| Auth            | **Supabase** (Auth)      | configured in the Supabase dashboard                |
| Edge functions  | **Supabase** (edge)      | `supabase/functions/` (empty, ready for use)         |

The Next.js server actions **stay on Vercel**: they are the application's
backend and they already talk to Supabase Postgres directly
(`DATABASE_URL_DIRECT`) and use Supabase Auth for sessions. This folder is the
Supabase CLI project: its schema history and any edge functions.

## Folder contents

- `config.toml` — Supabase CLI project config (project id, edge function
  settings).
- `migrations/` — the full SQL schema history (54 migrations), copied from the
  drizzle-generated history in `drizzle/`. Migration `0053` removed the inert
  RLS machinery (`app_user` role + policies; the app scopes per company in code
  via `lib/auth/scope.ts`), so the schema has no row-level security — do not
  re-add `pgRole`/`pgPolicy` entries. **`drizzle/` remains the source of
  truth for development** (`npm run db:generate` / `db:migrate`); when you
  regenerate there, copy the new migration here too, or run
  `supabase db pull` to diff.
- `functions/` — edge functions (Deno). Currently empty; see
  `functions/README.md` for what belongs here and how to add/deploy one.

## Deployment

### 1. Database

```bash
# Link the CLI to your Supabase project (the ref is in your project's URL)
supabase link --project-ref <your-project-ref>

# Apply the full schema history to the remote database
supabase db push

# Or reset a linked local/remote DB from the migrations
supabase db reset
```

Then seed the base data (`npm run db:seed-rbac`, `npm run db:seed-admin` from
the repo root — these run the drizzle seed scripts in `lib/db/`).

### 2. Edge functions

```bash
supabase functions deploy <function-name>
```

See `functions/README.md`.

### 3. Environment variables

All keys are read by the Vercel app (see `.env.example` at the repo root). The
Supabase-specific ones are:

- `NEXT_PUBLIC_SUPABASE_URL` — `https://<ref>.supabase.co`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — public anon key (safe for the browser)
- `SUPABASE_SERVICE_ROLE_KEY` — service role key (**server only**, never exposed)
- `DATABASE_URL_DIRECT` — Postgres connection string (the only one `.env.example`
  lists; `lib/db/index.ts` also accepts `DATABASE_URL` as a fallback alias)

For edge function secrets: `supabase secrets set KEY=value --env production`.

## Keeping the two migration histories in sync

1. Develop with drizzle as before: `npm run db:generate` writes a new SQL file
   into `drizzle/`.
2. Copy it into `supabase/migrations/` with a Supabase timestamp prefix (later
   than the last existing one):
   ```bash
   # e.g. after generating drizzle/0053_*.sql
   n=$(ls supabase/migrations/*.sql | wc -l); ts=$(printf '20260812%06d' $n)
   new=$(basename drizzle/0053_*.sql)
   cp "drizzle/$new" "supabase/migrations/${ts}_${new#*_}"
   ```
3. `supabase db push` applies it remotely. Already-applied migrations are
   skipped (the CLI tracks applied filenames), so pushing the full history onto
   an existing database is safe — nothing double-applies.

(`supabase db pull` can also regenerate `supabase/migrations/` from a live
database if the two ever drift apart — prefer keeping drizzle authoritative.)
