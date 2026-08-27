# Complete Site Audit — Royal Hardware ERP

**Audit date:** 27 August 2026<br>
**Scope:** application code, server actions, authorization boundaries, database permissions and integrity, business rules, dependency supply chain, migration discipline, build configuration, performance/reuse, generated-code hygiene, and rendered browser behavior.

## Executive assessment

The audited code now passes the project's complete offline quality gate, production build, database-backed invariant suite, migration validation, dependency-tree validation, and authenticated/unauthenticated browser smoke tests.

One **critical** vulnerability was confirmed and remediated: Supabase's `anon` and `authenticated` roles had effective access to the public database schema while row-level security was disabled. A caller holding the public anon key could therefore bypass the application's permission layer. Migrations `0068` and `0069` revoke public API access at the schema, relation, sequence, routine, and default-privilege levels. The live database was migrated and the new posture check confirms no effective access remains across 40 audited relations, one sequence, and one routine.

The codebase is materially safer, more deterministic, less redundant, and more maintainable than the starting point. It is suitable for release from a code-quality perspective, subject to the operational actions in **Residual risks and required owner actions**.

## Findings and disposition

| ID | Severity | Finding | Disposition |
|---|---:|---|---|
| SEC-01 | Critical | Public Supabase roles could bypass application authorization because broad grants existed while RLS was disabled. | **Fixed and applied live.** Revoked relation, sequence, routine, schema, PUBLIC, inherited, and future default privileges. Added a live regression check. |
| MIG-01 | High | Hand-authored migrations were not registered in Drizzle's journal, so `db:migrate` could report success without applying them. | **Fixed.** Registered migrations 0067–0069 and extended parity checks to require journal coverage. |
| BUS-01 | High | Item-bearing rows with an item selected but invalid/zero quantity could be silently filtered out, allowing a partially saved document instead of a validation error. | **Fixed.** Centralized line selection and validation; blank spare rows remain ignored while entered invalid rows are rejected. |
| BUS-02 | High | The quotation list query selected a company short name without grouping it, causing a live PostgreSQL query failure. | **Fixed during browser audit.** Added the missing group expression and a regression invariant. The page now renders all 33 live quotations. |
| SEC-02 | Medium | Production environment validation accepted incomplete/placeholder configuration. | **Fixed.** Required server and Supabase variables, protocol checks, placeholder rejection, key separation, and paired Upstash configuration. |
| SEC-03 | Medium | Security headers and a content security policy were incomplete. | **Fixed.** Added CSP, clickjacking, MIME-sniffing, referrer, opener/resource isolation, permissions, and transport headers. |
| SEC-04 | Medium | Preference and company-scope mutations could rely on a cached session. | **Fixed.** Mutations now resolve a live session; inaccessible scope changes are rejected and the scope cookie is `Secure` in production. |
| BUS-03 | Medium | Tax rates lacked one shared finite `0..100` invariant across UI, server, and database. | **Fixed and applied live.** Shared validator, form bounds, server enforcement, tests, and database check constraint. |
| PERF-01 | Medium | Product batch operations performed avoidable per-row reference resolution and writes over a high-latency database connection. | **Fixed.** Bounded batch resolution, multi-row insert, `UPDATE ... FROM (VALUES ...)`, range sequence allocation, and duplicate-ID rejection. |
| SEC-05 | Medium | Backup export scope used raw interpolated SQL for company identifiers. | **Fixed.** Replaced with parameterized SQL fragments. |
| SUP-01 | Medium | Development dependency chain included four moderate legacy `esbuild` advisories. | **Fixed.** Updated/overrode the affected toolchain; the full dependency audit is now zero at every severity. |
| MAINT-01 | Low | Generated Graphify reports/caches were tracked despite having no runtime references. | **Fixed.** Removed 328 generated files (about 10.8 MB) and ignored both generated output roots. |
| MAINT-02 | Low | Three direct packages were unused and three lint warnings remained. | **Fixed.** Removed `dompurify`, `ttsc`, and `@ttsc/graph` as direct dependencies; removed unused tuple bindings. `dompurify` remains only where required transitively by jsPDF. |
| OPS-01 | Informational | No continuous quality workflow or automated dependency update configuration existed. | **Fixed.** Added CI for install, checks, full audit, and production build, plus Dependabot for npm and GitHub Actions. |

## Security review

### Database boundary

The application intentionally performs authorization in its server-action layer rather than exposing the database through Supabase's public API. That architecture is safe only if public database roles cannot address the underlying schema. The audit tested effective privileges rather than merely inspecting RLS flags.

Implemented controls:

- `anon` and `authenticated` have no effective table/view/materialized-view/foreign-table privileges.
- Those roles have no sequence privileges, public routine execution, or public-schema `USAGE`/`CREATE`.
- `PUBLIC` grants were removed so role inheritance cannot silently reopen access.
- Default privileges were revoked so future tables, sequences, and functions remain closed.
- `lib/db/security-posture.check.ts` runs first in `npm run check:db` and fails closed if the posture regresses.

### Application authorization and mutation safety

The existing architecture contains strong controls that were preserved and extended:

- server mutations use live sessions and explicit resource/action/company permission checks;
- mutation errors are contained by `guard()` and returned to the form instead of unmounting it;
- mutation paths are audited and use operation IDs/idempotency protection;
- company scoping is applied to reads and write targets;
- document lifecycles lock and re-check active state before mutation;
- the WhatsApp assistant resolves a real user and reuses the same server actions, with confirmation required before writes;
- backup and report actions require live authority and parameterized scope.

### Web layer

An unauthenticated request to `/dashboard` returns a `307` redirect to `/login`. The response includes CSP, `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff`, strict referrer policy, opener/resource isolation, restricted browser permissions, and HSTS. Server Action bodies are capped at 1 MB using the current Next.js 16 configuration.

The production configuration rejects missing or placeholder Supabase URL, anon key, service-role key, and database URL values; it also rejects an identical anon/service key pair and incomplete Upstash pairs.

## Business-logic and data-integrity review

The audit covered sales, quotations, purchases, market purchases, payments, settlements, stock movements, transfers, adjustments, inter-company flows, products, contacts, accounts/general ledger, reports, taxes, sessions, cache invalidation, numbering, and operation IDs.

Live integrity queries found:

- zero tax rates outside `0..100`;
- zero negative line monetary values;
- zero ledger rows with both debit and credit, or with neither side populated;
- zero cross-company document/contact relationships;
- zero cross-company document-line/item relationships;
- zero cross-company inventory/document-line relationships;
- zero cross-company payment allocations;
- two zero-quantity/base-quantity opening-stock lines, both legitimate rate-only opening records;
- sixteen legacy pending quotations with negative document totals, minimum `-5.00`.

Current document-entry logic now rejects entered item rows with non-finite or invalid quantities instead of dropping them. The sixteen negative quotations are pre-existing data and were intentionally not modified by this audit.

## Maintainability, reuse, and performance

The main refactoring outcomes are:

- a shared financial-input selector now distinguishes truly blank spare rows from invalid entered rows across sales, quotations, purchases, transfers, adjustments, and inter-company documents;
- one shared tax-rate validator drives server validation and tests, backed by UI and database constraints;
- product batch creation/update shares reference resolution and uses set-based SQL instead of per-row round trips;
- migration parity now covers Drizzle SQL, Supabase mirrors, and the executable Drizzle journal;
- raw company-ID SQL construction was removed from backup export;
- unused analysis artifacts and direct dependencies were removed;
- new non-trivial behavior is pinned by runnable `*.check.ts` checks.

The product refactor also removes an invalid `ON CONFLICT` assumption against a non-unique category-name column and allocates product sequence numbers in one range.

## Rendered-site audit

The in-app browser used an existing authenticated session for read-only testing; no forms were submitted and no business records were changed.

Tested routes included dashboard, contacts, products, stock, stock purchases, market purchases, new sale, invoices, quotations, payments, ledger, reports, users, settings, and audit logs. The audit also inspected the complete navigation drawer and login page.

Results:

- login labels, required input types, and password/email autocomplete semantics are present;
- desktop and 375×812 mobile layouts render without page-level horizontal overflow;
- dense tables retain their own controlled horizontal scrolling;
- representative live lists and forms render successfully;
- the quotation runtime SQL failure was reproduced, fixed, and retested;
- a clean browser pass over dashboard, quotations, and products produced zero console warnings/errors;
- the unauthenticated authorization redirect and response headers were independently verified.

## Verification evidence

The final working tree passed:

- `npm run check` — TypeScript, ESLint with zero warnings, and the complete offline/business/security architecture suite;
- `npm run build` — optimized Next.js 16.3.1 production build; all 44 application page modules and framework routes compiled;
- `npm run check:db` — live database security posture, cache invalidation, numbering/concurrency, balances, GL, FIFO stock costing, settlements, allocations, purchases, taxes, sessions, idempotency, all 13 reports, products/options, and all 17 search branches;
- `npm audit --json` — 0 vulnerabilities at all severities across 530 dependencies;
- `npm ls --all` — dependency tree valid;
- `npx drizzle-kit check` — schema/migration validation passed;
- migration parity — 70 Drizzle/Supabase migration files and journal registration passed;
- `git diff --check` — no whitespace errors.

Live migrations applied during remediation:

- `0067_tax_rate_guard.sql`
- `0068_close_public_database_api.sql`
- `0069_remove_inherited_public_api_grants.sql`

## Residual risks and required owner actions

These items cannot be safely resolved from source code alone and should remain visible in the release decision.

1. **High — Authentication policy is operational.** Confirm Supabase MFA is mandatory for administrators and finance users, disable weak/leaked passwords, review session lifetime, and verify recovery procedures in the Supabase dashboard.
2. **High if copied or shared — Local environment backups.** Ignored files named `.env.bak`, `.env.backup-sydney`, `.env.local`, and `.env` exist locally. They were not opened or changed. Determine whether backups are still required, securely remove obsolete copies, and rotate credentials if any file was ever copied, emailed, uploaded, or shared.
3. **Medium — Legacy negative quotations.** A business owner must decide whether the sixteen pending negative-total quotations are test artifacts, credits modeled incorrectly, or records to cancel/correct. Do not mass-edit them without that decision and an audit trail.
4. **Medium — Shared-device offline data.** The offline shell is cleared on logout, but an abandoned authenticated session on a shared machine can retain readable cached HTML. Enforce device lock/auto-lock, disk encryption, and explicit logout on shared or kiosk devices.
5. **Medium — End-to-end mutation coverage.** The audit deliberately avoided creating/deleting live business records. Add an isolated staging database and Playwright flows for every critical create/edit/delete/cancel/convert operation before large future releases.
6. **Low/Medium — CSP strictness.** The production CSP removes development-only `unsafe-eval`, but retains `unsafe-inline` for framework compatibility. A nonce/hash-based CSP is a worthwhile defense-in-depth project if the deployment platform supports request-scoped nonces.
7. **Operational — Backup restoration.** Export dispatch logic and version handling are checked, but a backup is not proven until a current production-format backup is restored into an isolated database and reconciled. Schedule and document periodic restore drills.

## Audit limitations

This was a comprehensive code, database, dependency, build, and rendered-behavior audit within the available repository and connected database. It is not a guarantee against every future vulnerability and does not replace an external infrastructure review, credential compromise assessment, social-engineering test, denial-of-service/load test, or third-party penetration test. No secret values were inspected or included in this report.
