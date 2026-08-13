# Royal Hardware ERP — Deployment

**Phase:** 12 of 12
**Status:** Deployed. Frontend + Server Actions on Vercel (`erp.royalhardware.co`),
database + Auth on Supabase. This document reflects the codebase as it is today
(no RLS machinery, four environment variables, PWA/offline).

---

## 0. The split

One Next.js (App Router) codebase, deployed in two halves:

| Part | Where it runs | Lives in |
|---|---|---|
| Frontend (UI) | **Vercel** | `app/`, `components/` |
| Server Actions (the backend) | **Vercel** (Next.js serverless) | `lib/actions/`, `lib/queries/`, `lib/db/` |
| Database (Postgres) | **Supabase** | `supabase/migrations/` (mirror of `drizzle/`) |
| Auth (sessions) | **Supabase** (Auth) | configured in the Supabase dashboard |
| Edge functions | **Supabase** (edge) | `supabase/functions/` (empty, ready for use) |

There is no separate backend server: the Server Actions *are* the backend, and
they talk to Supabase Postgres directly over `DATABASE_URL_DIRECT`. Sessions are
Supabase Auth via `@supabase/ssr` (`proxy.ts` refreshes the cookie on every
request). See `supabase/README.md` for the full split.

## 1. Provision Supabase

1. Create a Supabase project (this is the Postgres database — no separate DB
   provider needed).
2. Note the project URL and keys for `.env` (see `.env.example`): the **only**
   four variables the app reads are
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, and `DATABASE_URL_DIRECT`.
3. Enable Email/Password auth (Authentication → Providers). This is an internal
   tool — disable public signup; accounts are provisioned via
   `npm run db:seed-admin <email> <password>`.
4. Set a stricter-than-default rate limit on login attempts (Authentication →
   Rate Limits).

**No Row Level Security to configure.** The app connects as Supabase's
`postgres` role (BYPASSRLS) and scopes every query per company in application
code (`requirePermission` in `lib/auth/permissions.ts`, `companyInScope` in
`lib/auth/scope.ts`). The `app_user` role, its ~18 policies, and
`lib/db/context.ts`'s `withUserContext()` were removed (migration `0053`); the
schema no longer carries `pgRole`/`pgPolicy` entries.

## 2. Apply migrations and seed

`drizzle/` is authoritative for development; `supabase/migrations/` mirrors it
for the Supabase CLI (54 migrations, including `0053` which removed the RLS
machinery).

```bash
# Development: apply locally with drizzle
npm run db:migrate

# Supabase: link the CLI and push the mirrored history
supabase link --project-ref <ref>
supabase db push
```

Then seed the base data (fresh database only):

```bash
npm run db:seed-rbac        # roles + the full permission catalog (Admin, Salesman)
npm run db:seed-admin       # companies, warehouses, channels, admin account
```

When a new migration is generated with `npm run db:generate`, copy the new file
into `supabase/migrations/` with a later timestamp prefix (steps in
`supabase/README.md`).

## 3. Deploy to Vercel

1. Import the repository into Vercel.
2. Set every variable from `.env.example` in Vercel's Environment Variables
   (Production + Preview) — exactly four: `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
   `DATABASE_URL_DIRECT`. (`lib/db/index.ts` also accepts `DATABASE_URL` as a
   fallback alias, but nothing else is read — no WhatsApp, Google Drive, or
   cron keys exist in the codebase anymore.)
3. Deploy. There is no build step beyond `next build`, no client-generation
   codegen, and no `vercel.json` needed.
4. `proxy.ts` (the auth middleware) exempts `/manifest.json`, `/sw.js`, and the
   static assets from the login redirect, so the PWA metadata is reachable
   before sign-in.

## 4. PWA / offline (already built)

- `public/manifest.json`, `public/icon.svg`, `public/sw.js` — installable PWA
  with an offline app shell: network-first pages with cache fallback,
  stale-while-revalidate for static assets.
- The service worker only caches 200 responses; an error page can't poison the
  cache (the error boundary tells the SW to purge its copy).
- Draft protection (`lib/draft.ts` + `components/ui/useDraft.tsx`) keeps typed
  work — sale/purchase/quotation/inter-company/transfer/adjustment forms and
  the expense/payment batch dialogs — across reloads and offline sessions.

## 5. Checks

No CI workflow exists in the repo. Run the check suites before deploying:

```bash
npm run check               # typecheck + lint + every offline check
npm run check:db            # against .env — cache coverage, sequences, reports
```

## 6. Post-deploy smoke checklist

- [ ] Sign in as the seeded Admin account, confirm the Dashboard loads with
      real figures (not zeros and not errors).
- [ ] Reload the Dashboard and a report page — repeat visits render instantly
      from the in-process aggregate cache, and creating a sale updates
      "Today's Sales" immediately (write-invalidation).
- [ ] Post a Sale, confirm stock decremented and an Invoice number generated.
- [ ] Confirm a Salesman-role account cannot see cost/margin fields or the
      Purchases/Suppliers/Reports nav items.
- [ ] Install the app (browser install prompt / manifest) and reload a page
      offline — the cached shell renders, and typed form work is offered back
      via the draft banner.
