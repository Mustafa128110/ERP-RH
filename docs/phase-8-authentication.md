# Royal Hardware ERP — Authentication & Authorization

**Phase:** 8 of 12
**Status:** Implemented and applied to the live Supabase database, ahead of Phase 9, to unblock login (proceeding without per-phase pause, per instruction)
**Depends on:** [Phase 3 — Database Design](phase-3-database-design.md), [Phase 7 — API Design](phase-7-api-design.md)

**Path convention note:** this doc originally described paths under `src/` (`src/lib/db/schema.ts`, `src/middleware.ts`, `src/lib/supabase/*`, `src/hooks/`), matching Phase 5's draft folder structure. The actual repo has no `src/` directory — everything implemented below lives at the repo root (`lib/`, `proxy.ts`), and that's what's referenced from here on. Phase 5 still needs reconciling against this (see its own open note).

**Framework note:** this Next.js version (16) renamed the `middleware.ts` file convention to `proxy.ts` (exported function renamed `middleware` → `proxy` too) — see `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`. The repo already had a `proxy.ts` (the placeholder auth's edge-redirect check) before this phase's work started; it's now rewritten to delegate to `lib/supabase/middleware.ts`'s `updateSession()` rather than replaced by a competing `middleware.ts` — Next.js hard-errors at boot if both files exist.

---

## 1. Identity Model

- **Supabase Auth** is the identity provider (email + password). This is an internal business tool, not a public product — there is no self-signup; an Admin creates accounts via the Supabase Admin API (`createUser` action from Phase 7 §1.10), which also provisions the corresponding `users` row (`supabase_auth_id` FK).
- Password policy: minimum 10 characters, enforced at Supabase project level; failed-login rate limiting configured at the Supabase Auth project level (per FR §0.7 of Phase 7).
- No self-service password reset email flow is exposed publicly beyond the standard "Forgot password" link on Login (Phase 6) — it uses Supabase's built-in recovery flow.

## 2. Session Handling (`@supabase/ssr`)

Three client instances, matching the `lib/supabase/` folder from Phase 5:

| File | Used by | Purpose |
|---|---|---|
| `lib/supabase/client.ts` | Client Components | Browser Supabase client, reads session from cookies |
| `lib/supabase/server.ts` | Server Components, Server Actions | Server client bound to the request's cookies; this is what `lib/auth/session.ts`'s `getSession()` resolves its session from |
| `lib/supabase/middleware.ts` | `proxy.ts` (repo root) | Refreshes the session cookie on every request so it never silently expires mid-session |
| `lib/supabase/admin.ts` | Admin API calls, background jobs | Service-role client — bypasses RLS and Auth entirely. Only for `createUser` (§1) and background jobs (backup cron, WhatsApp webhook), never for a request scoped to an end user |

`proxy.ts` runs on every request except the login page itself: it resolves the session, redirects to `/login` if absent (and away from `/login` to `/dashboard` if already signed in), and otherwise lets the request through. Note `(dashboard)` is a Next.js **route group** — its pages share no URL prefix (`/inventory`, `/sales`, `/reports`, ... are all siblings, not `/dashboard/*`) — so the matcher can't key off a path prefix; it protects everything except `/login` instead. The actual permission decision happens per-action (§4), not in proxy, because proxy only knows "who," not "who, doing what, to which company/warehouse."

`lib/auth/session.ts`'s `getSession()` is wrapped in React's `cache()` so it resolves once per request; `requireSession()` calls it and redirects to `/login` if absent (used by `(dashboard)/layout.tsx`). `lib/auth/permissions.ts`'s `requirePermission(session, module, action, scope?)` is the enforcement point described in §3.

## 3. Authorization Model (RBAC)

This is the runtime side of the `roles` / `permissions` / `role_permissions` / `user_roles` tables from Phase 3 and the Settings → Roles screen from Phase 6.

- A user can hold a **different role per company** — `user_roles.company_id` is nullable: `NULL` means that role assignment applies globally (every company the user can access via `user_company_access`); a set value scopes it to just that one company (e.g. Admin globally, but Salesman specifically in M52 — two `user_roles` rows). On session resolution, `lib/auth/session.ts` loads the user's roles and splits their permissions into `globalPermissions` (from `NULL`-company assignments) and `permissionsByCompany` (a `Map<companyId, Set<permission>>` from company-scoped assignments) — cached per-request (not per-login) so a permission change takes effect on the user's next request, not their next login.
- `requirePermission(session, module, action, scope?)` (used by every Server Action per Phase 7 §0.2):
  1. Checks the user has `action` on `module` — via `globalPermissions`, or via `permissionsByCompany.get(scope.companyId)` if a `companyId` was given, or via *any* company's permission set if no `companyId` was given (module-level UI gating before a company is selected).
  2. If `scope.companyId` is given, also checks it's in the user's `user_company_access`.
  3. If `scope.warehouseId` is given, checks it's in the user's `user_warehouse_access`.
  4. Throws a typed `PermissionError`, caught centrally and converted to `PERMISSION_DENIED` (Phase 7 §0.1).
- Seed data ships two roles (Admin, Salesman) per FR-USER-003, via `npm run db:seed-rbac` (69 permissions across 23 modules, Admin gets all of them, Salesman gets the exact FR-USER-003 matrix); additional roles are created through the UI, not code, per the RBAC extensibility requirement in the constitution. The first Admin account (Supabase Auth user + `users` row + role + company access) is created with `npm run db:seed-admin <email> <password>`.

## 4. Defense in Depth: RLS as the Second Gate

Phase 3 flagged that every company/warehouse-scoped table carries explicit `company_id`/`warehouse_id` columns specifically so Postgres Row Level Security could enforce scoping at the database layer, not only in application code. This phase turns that on — and the mechanism is more deliberate than "just enable RLS," because Drizzle's direct Postgres connection (via `postgres.js`) doesn't participate in Supabase's `auth.uid()`/PostgREST machinery the way `supabase-js` does:

- **The gotcha:** Drizzle talks to Postgres over a direct connection string, which by default authenticates as a role with `BYPASSRLS` (Supabase's own `postgres` role, which is what `DATABASE_URL` connects as). Enabling RLS policies against `auth.uid()` would have **zero effect** on any Drizzle query — that GUC is only populated when a request goes through Supabase's PostgREST layer, which this app doesn't use.
- **The fix:** a dedicated, non-bypass `app_user` role, defined via `pgRole('app_user')` in `lib/db/schema.ts` alongside its `pgPolicy` entries, that the connecting role can temporarily assume with `SET LOCAL ROLE app_user` — scoped to one transaction, reverting automatically at commit. `lib/db/context.ts`'s `withUserContext(userId, fn)` does exactly this via `db.transaction(tx => { ... })` and `tx.execute(sql\`set local role app_user\`)` + `tx.execute(sql\`select set_config('app.user_id', ${userId}, true)\`)`, so policies can identify the caller. Policies are written against `current_setting('app.user_id', true)`, not `auth.uid()`.
- Every table that actually carries a `company_id` column gets a `pgPolicy` with `using: sql\`company_id IN (SELECT company_id FROM user_company_access WHERE user_id = current_setting('app.user_id', true)::uuid)\`` (plus a matching `withCheck`) — as of Phase 3 §0.6 that's 21 tables: `contacts`, `items`, `documents`, `chart_of_accounts`, `price_lists`, `settings`, `locations`, `categories`, `brands`, `units`, `taxes`, `payment_methods`, `expense_categories`, `document_types`, `currencies`, `document_lines`, `inventory_transactions`, `ledger_entries`, `item_images`, `unit_conversions`, `attachments`. `locations` and `attachments` additionally allow a `NULL` `company_id` through (shared location / document-less attachment); `locations` also OR's in direct `user_warehouse_access` (a location *is* the warehouse entity, per Phase 3 §0).
- **A second gotcha, discovered while applying this:** Supabase force-enables RLS on *every* new table in the `public` schema by default — not just the ones this schema calls `.enableRLS()` on. That's a project-level default outside Drizzle's tracking (`drizzle-kit generate` diffs `schema.ts` against its own snapshot history, not the live database, so it never sees this drift). Left alone, other tables (`roles`, `permissions`, `users`, `audit_log`, ...) would end up RLS-enabled with **zero policies** — under `app_user`, every query against them returns/affects zero rows, since "RLS on + no policy" defaults to deny-all. `drizzle/0003_disable_rls_on_unscoped_tables.sql` explicitly disables RLS on the 22 tables that don't carry `company_id`: they're either RBAC/identity tables gated by `requirePermission()` at the app layer instead of RLS (`users`, `roles`, `permissions`, `role_permissions`, `user_roles`, `user_company_access`, `user_warehouse_access`), `audit_log` (nullable `company_id` for filtering only, no RLS — same reasoning), or `companies` itself. **If you add a new table, check `relrowsecurity` on it after migrating** — don't assume "I didn't call `.enableRLS()`" means RLS is off.
- **Why both layers, not just one:** `requirePermission()` is what produces good error messages and clean `ActionResult` responses; RLS is what makes it *structurally impossible* for a bug in a service function to leak another company's row, even if a permission check is accidentally skipped. Application code should never rely on RLS silently filtering results it forgot to filter itself — RLS is the backstop, not the primary mechanism.
- **The cost (not yet paid):** the *intent* is that every repository function takes a `db` (transaction client) as its first argument instead of importing a shared `db` singleton, with a `lib/actions/wrap.ts` wrapping every Server Action's handler in `withUserContext` automatically. **Neither exists yet** — no repositories or Server Actions are wired to `withUserContext` at all yet (that's Phase 9 work); `withUserContext` itself is implemented and ready in `lib/db/context.ts`, just unused so far. Background/system code (the backup cron route, the WhatsApp webhook handler) will deliberately keep using the plain `db` singleton (`@/lib/db`) once built — there's no end-user session to scope by, and it needs to see across every company.

## 5. CSRF, XSS, Input Validation

- **CSRF:** Next.js Server Actions are POST-only and carry Next's built-in encrypted action reference, which is not guessable/forgeable from a third-party origin — this satisfies the constitution's CSRF requirement without a separate token scheme. The Route Handler exceptions (Phase 7 §0.4) that accept external POSTs (`/api/webhooks/whatsapp`) are protected by Meta's signature header instead, not CSRF tokens, since they're not browser-form-submitted.
- **XSS:** React's default escaping covers all rendered data; the only place raw HTML could enter is WhatsApp template previews and invoice PDFs — both are generated server-side from structured data, never from unescaped user input interpolated into markup.
- **Input validation:** every Server Action re-validates with Zod server-side regardless of client-side React Hook Form validation (Phase 7 §0.2 step 3) — this is the primary SQL-injection defense in practice, on top of Drizzle's parameterized queries making raw SQL injection structurally unavailable in the first place.

## 6. Company/Warehouse Context at Runtime

Tying back to Phase 5 §3: the `CompanyProvider`/`WarehouseProvider` context is meant to be what the UI *displays*, with every Server Action independently re-deriving and checking scope via `requirePermission(..., { companyId, warehouseId })` — a tampered client-side context value (e.g. someone editing the cookie) would fail at the permission check, then again at the RLS layer if it somehow got past that. **Not built yet** — no `CompanyProvider`/`WarehouseProvider`, no Server Actions exist at all yet (Phase 9). `requirePermission()` itself is implemented and ready in `lib/auth/permissions.ts`.

---

## Open Items

- MFA is not in scope for v1 — flagged as a future hardening step once the business has more than a handful of Admin accounts.
- Session/JWT expiry duration (Supabase default is 1 hour access / long-lived refresh) is left at platform defaults; revisit if shop-floor tablet sessions need to stay logged in longer without a refresh hiccup.
- No `companies` rows exist yet — `user_company_access` can't be populated for real accounts until Royal Hardware/M52 are seeded (Phase 3 §1's "Seed" note).
- Nothing calls `withUserContext()`/`requirePermission()` yet — they're implemented and verified structurally sound, but Phase 9's repositories/Server Actions are what will actually exercise them for the first time.

---

**Status:** The identity/authorization *layer* is implemented and applied to the live database: `lib/db/schema.ts` (`roles`/`permissions`/`role_permissions`/`user_roles`/`user_company_access`/`user_warehouse_access`, `pgRole('app_user')` + `pgPolicy` RLS policies on the 21 company-scoped tables per Phase 3 §0.6, RLS explicitly disabled on the other 9 per the Supabase-default gotcha in §4), `lib/supabase/{client,server,middleware,admin}.ts`, `proxy.ts`, `lib/auth/session.ts`, `lib/auth/permissions.ts`, and `lib/db/context.ts` all exist and are migrated onto Supabase (`drizzle/0002`–`0006`). Login (`app/(auth)/login`) and logout (`components/layout/Topbar.tsx`) work end-to-end against real Supabase Auth + the `users`/`roles` tables. `npm run db:seed-rbac` and `npm run db:seed-admin` provision the permission catalog and the first Admin account respectively. **Not yet built:** any repository/service/Server Action that actually calls `withUserContext()` or `requirePermission()` (Phase 9), `CompanyProvider`/`WarehouseProvider` (Phase 5/9), and no integration test yet proves the RLS policies actually block cross-company reads (Part B of the hardening plan) — see `docs/phase-11-testing.md`.
