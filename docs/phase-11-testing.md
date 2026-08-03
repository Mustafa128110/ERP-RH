# Royal Hardware ERP — Testing

**Phase:** 11 of 12
**Status:** Unit tests implemented and passing; integration/e2e scaffolded, not yet runnable in this environment (no live Postgres/Supabase project connected here)

---

## 1. What's actually running today

**Unit tests — `npm test` (Vitest), 17/17 passing:**

| File | Covers |
|---|---|
| `tests/unit/lib/unit-conversion.test.ts` | FR-UNIT-002 — direct edges, multi-hop chains, implicit inverse direction, no-path case |
| `tests/unit/lib/document-number.test.ts` | Document numbering, including per-company scoping (`INV-RH-001042` vs `INV-M52-000210`) |
| `tests/unit/modules/inventory/stock/stock-ledger.test.ts` | FR-PROD-006 Weighted Average Cost — the exact calculation every profit report depends on, including the zero-quantity divide-by-zero edge case |

These three were chosen deliberately: they're the pure, DB-free business logic that the rest of the system's correctness rests on. `postStockMovement` itself was refactored to extract `computeBalanceAfterMovement` as a pure function specifically so this math is testable without a database (see `src/modules/inventory/stock/services/stock-ledger.service.ts`).

## 2. What's scaffolded but needs a real database to run

- **Integration tests** (`tests/integration/`, referenced in `docs/phase-5-folder-structure.md`, not yet populated): the highest-value ones to write next are `postSale` (does it really block on insufficient stock, does the customer ledger balance come out right, does a double-post get rejected by the atomic status guard) and `receiveStockTransfer` (does a quantity mismatch correctly populate `variance_quantity`). These need a real Postgres instance — `drizzle-kit migrate` against a test database — which this environment doesn't have.
- **E2E** (`tests/e2e/login.spec.ts`, Playwright config at `playwright.config.ts`): one smoke test is written and passes conceptually (unauthenticated → redirected to `/login`, form renders), but running it for real needs `npm run dev` against a seeded database plus a real Supabase Auth user to test the full sign-in → Dashboard path.

## 3. To make the above runnable

1. Provision a Postgres database (Supabase project, or local Postgres via Docker) and point `DATABASE_URL` at it.
2. `npm run db:migrate` — applies the Drizzle migrations in `drizzle/` (`drizzle-kit migrate`).
3. `npm run db:seed` — seeds companies, warehouses, roles/permissions, sales channels, expense categories, and a few sample products (`src/lib/db/seed.ts`).
4. Create at least one Supabase Auth user and a matching `users` row with the Admin role, so `npm run test:e2e` has something to sign in as.
5. Write the integration tests named above under `tests/integration/`, using a disposable test database (a separate `DATABASE_URL` from dev, torn down between runs).

## 4. What manual verification confirmed in this session

- `npx tsc --noEmit` — clean across the entire codebase at every step it was built.
- `npm run build` — production build succeeds; all dashboard routes correctly resolve as dynamic (`ƒ`) because they read the session cookie, ungated static routes (`/login`, `/`) prerender as static (`○`).
- No live dev-server/browser verification was possible in this session (no database to actually sign in against) — this is the one gap between "builds and type-checks" and "verified working" that should be closed before go-live, per the `/verify` skill's standard: type-checking is not the same as observed runtime behavior.

---

**Next Step:** On approval, proceed to **Phase 12 — Deployment**.
