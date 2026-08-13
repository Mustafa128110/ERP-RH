# Royal Hardware ERP — Authentication & Authorization

**Phase:** 8 of 12
**Status:** Implemented, deployed, and in daily use — every Server Action enforces permissions and per-company scope at the app layer; the RLS machinery was removed (migration `0053`).
**Depends on:** [Phase 3 — Database Design](phase-3-database-design.md), [Phase 7 — API Design](phase-7-api-design.md)

**Path convention note:** this doc originally described paths under `src/` (`src/lib/db/schema.ts`, `src/middleware.ts`, `src/lib/supabase/*`, `src/hooks/`), matching Phase 5's draft folder structure. The actual repo has no `src/` directory — everything implemented below lives at the repo root (`lib/`, `proxy.ts`), and that's what's referenced from here on. Phase 5 still needs reconciling against this (see its own open note).

**Framework note:** this Next.js version (16) renamed the `middleware.ts` file convention to `proxy.ts` (exported function renamed `middleware` → `proxy` too) — see `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`. The repo already had a `proxy.ts` (the placeholder auth's edge-redirect check) before this phase's work started; it's now rewritten to delegate to `lib/supabase/middleware.ts`'s `updateSession()` rather than replaced by a competing `middleware.ts` — Next.js hard-errors at boot if both files exist.

---

## 1. Identity Model

- **Supabase Auth** is the identity provider (email + password). This is an internal business tool, not a public product — there is no self-signup; an Admin creates accounts via the Supabase Admin API (user provisioning in `lib/actions/users.ts`), which also provisions the corresponding `users` row (`supabase_auth_id` FK).
- Password policy: minimum 10 characters, enforced at Supabase project level; failed-login rate limiting configured at the Supabase Auth project level (per FR §0.7 of Phase 7).
- No self-service password reset email flow is exposed publicly beyond the standard "Forgot password" link on Login (Phase 6) — it uses Supabase's built-in recovery flow.

## 2. Session Handling (`@supabase/ssr`)

Three client instances, matching the `lib/supabase/` folder from Phase 5:

| File | Used by | Purpose |
|---|---|---|
| `lib/supabase/client.ts` | Client Components | Browser Supabase client, reads session from cookies |
| `lib/supabase/server.ts` | Server Components, Server Actions | Server client bound to the request's cookies; this is what `lib/auth/session.ts`'s `getSession()` resolves its session from |
| `lib/supabase/middleware.ts` | `proxy.ts` (repo root) | Refreshes the session cookie on every request so it never silently expires mid-session |
| `lib/supabase/admin.ts` | Admin API calls, user provisioning | Service-role client — bypasses Auth entirely. Only for user provisioning (§1, `createUsersBatch` in `lib/actions/users.ts`), never for a request scoped to an end user |

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

## 4. Scoping & Authorization: App-Layer Enforcement

Phase 3 planned for Row Level Security as a second gate — a dedicated
non-bypass `app_user` role, `pgPolicy` entries on every company-scoped table,
and a `withUserContext()` transaction wrapper that switched the connection into
that role. **That machinery was removed in migration `0053`.** Nothing ever
activated it: no code called `withUserContext()`, and it could not work as
designed — Drizzle talks to Postgres over a direct connection string as a
BYPASSRLS role (Supabase's own `postgres` role), and RLS policies keyed on
`current_setting('app.user_id')`/`auth.uid()` only take effect when a request
goes through Supabase's PostgREST layer, which this app never uses.

The database now has **no RLS** — every table ships with RLS disabled — and
enforcement is entirely at the application layer, where it actually runs:

- **Authentication** — `getSession()` (`lib/auth/session.ts`), resolved once per
  request via React's `cache()`; `proxy.ts` refreshes the session cookie and
  guards every route except `/login`.
- **Permission** — `requirePermission(session, module, action, scope?)`
  (`lib/auth/permissions.ts`), called at the top of every Server Action (§3).
- **Company scope** — `companyInScope(column)` / `getScopeCompanyIds()`
  (`lib/auth/scope.ts`) are threaded into the `.where()` of every data query,
  so a user can only read and write rows of companies they hold access to
  (`user_company_access`).

Because scope is enforced per query, a bug that skips a permission check cannot
leak another company's rows — every read path filters by scope regardless of
which action invoked it. The trade is that nothing is enforced by the database
itself: a future feature that connects to Postgres directly must scope by
company too (that invariant is held by review, not by a DB mechanism), and
`DATABASE_URL_DIRECT`/`SUPABASE_SERVICE_ROLE_KEY` must never be exposed to the
browser.

## 5. CSRF, XSS, Input Validation

- **CSRF:** Next.js Server Actions are POST-only and carry Next's built-in encrypted action reference, which is not guessable/forgeable from a third-party origin — this satisfies the constitution's CSRF requirement without a separate token scheme. There are no externally-receiving route handlers left (the WhatsApp webhook was removed), so nothing accepts unsigned browser-origin POSTs.
- **XSS:** React's default escaping covers all rendered data; the only place raw HTML could enter is the invoice PDF, which is generated server-side from structured data, never from unescaped user input interpolated into markup.
- **Input validation:** every Server Action re-validates with Zod server-side regardless of client-side React Hook Form validation (Phase 7 §0.2 step 3) — this is the primary SQL-injection defense in practice, on top of Drizzle's parameterized queries making raw SQL injection structurally unavailable in the first place.

## 6. Company/Warehouse Context at Runtime

The company scope shown in the UI comes from the Topbar selector. Every Server
Action independently re-derives the scope server-side (`getScopeCompanyIds()`,
`companyInScope()` in `lib/auth/scope.ts`) and checks permission via
`requirePermission(...)` — a tampered client-side value (e.g. someone editing a
cookie) fails at the permission check, and the queries themselves are scoped
per company, so nothing outside the user's `user_company_access` is reachable.

---

## Open Items

- MFA is not in scope for v1 — flagged as a future hardening step once the business has more than a handful of Admin accounts.
- Session/JWT expiry duration (Supabase default is 1 hour access / long-lived refresh) is left at platform defaults; revisit if shop-floor tablet sessions need to stay logged in longer without a refresh hiccup.
- Because enforcement is application-layer only (no RLS), a future feature that connects to Postgres directly must remember to scope by company — see §4.

---

**Status:** Authentication and authorization are implemented, deployed, and in
daily use. `lib/supabase/{client,server,middleware,admin}.ts`, `proxy.ts`,
`lib/auth/session.ts`, `lib/auth/permissions.ts`, and `lib/auth/scope.ts` run
the whole app — every Server Action checks `requirePermission()` and scopes its
queries per company (`lib/auth/scope.ts`). Login (`app/(auth)/login`) and
logout (`components/layout/Topbar.tsx`) work against real Supabase Auth + the
`users`/`roles` tables; `npm run db:seed-rbac` and `npm run db:seed-admin`
provision the permission catalog and the first Admin account. The RLS layer
planned in Phase 3 (§4 above) was built, never activated, and **removed** in
migration `0053` (along with `lib/db/context.ts`'s `withUserContext()`) —
enforcement is application-layer only.
