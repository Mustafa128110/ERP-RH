# Royal Hardware ERP — Folder Structure

**Phase:** 5 of 12
**Status:** Draft for approval
**Depends on:** [Phase 3 — Database Design](phase-3-database-design.md), [Phase 4 — ER Diagram](phase-4-er-diagram.md)

This defines the Next.js project layout that Phases 7–10 (API, Auth, Backend, Frontend) build inside. The goal is one consistent shape so any module — Products or Expenses or WhatsApp — is navigated the same way.

---

## 0. Structural Decisions

### 0.1 `app/` stays thin; `modules/` holds the logic

Next.js App Router pages/layouts do **routing and composition only** — they import a module's components/hooks and render them. No database/Drizzle calls, no business rules, no Zod validation logic inside `app/`. This is what keeps "Consistent Folder Structure" and "No duplicated logic" true as the module count grows: a route file for Products and a route file for Expenses look identical in shape, differing only in which module they import from.

### 0.2 Every module is the same five folders

```
modules/<domain>/<feature>/
├─ components/     UI specific to this feature (e.g. ProductForm, ProductTable)
├─ actions/         Server Actions — the only entry point the UI calls
├─ services/        Business logic — orchestrates repositories, posts stock movements, writes audit log
├─ repositories/     The only layer that talks to the database (Drizzle) directly
├─ schemas/          Zod validation for this feature's inputs
├─ types/            TS types specific to this feature
└─ hooks/            TanStack Query hooks wrapping the actions (useProducts, useCreateProduct...)
```

**Repository Pattern, strictly enforced:** only `repositories/` imports `@/lib/db`. Services never construct a Drizzle query directly — this is what makes "swap the data layer later" actually possible and keeps business rules (e.g. FR-PROD-002 "can't delete a transacted product") out of query code where they'd be easy to miss.

**Server Actions vs Route Handlers:** internal mutations (creating a Sale, posting a Purchase) are Server Actions called directly from client components — no hand-rolled REST layer for the UI's own use. Route Handlers under `app/api/` exist only for things that *aren't* the UI calling itself: the Meta WhatsApp delivery-status webhook, and the scheduled backup cron endpoint (Phase 12 wires this to Vercel Cron).

### 0.3 Audit logging is a service-layer concern, not a DB trigger

A Postgres trigger can't see the requester's IP address or user-agent — those are HTTP-request details. So every `services/*.ts` mutation calls a shared `lib/audit/log.ts` helper, passing the acting user, old/new value, and request metadata. This is a rule to enforce in code review (Phase 11), not something the schema can guarantee by itself.

### 0.4 Centralized constants/types mirror the Drizzle enums

Movement types, document statuses, roles — anything that's a Drizzle `pgEnum` also gets a single TS source of truth in `lib/constants/`, imported by both server and client code. This is what "Centralized Constants" and "Centralized Types" mean concretely: nobody re-types `"pending_approval"` as a string literal in a second file.

### 0.5 Shared validation primitives, feature-specific schemas

`lib/validation/` holds primitives reused across modules — PKR money (fixed-point, not float), Pakistani phone/WhatsApp number format, SKU pattern, GST rate bounds. Each module's `schemas/` folder composes these primitives into its own Zod object rather than redefining them, satisfying "Reusable Validation" without a god-schema file that every module fights over.

### 0.6 Shared data-table wrapper

Products, Sales, Purchases, Stock Movement History, Customer/Supplier Ledger — every one of these is a large, sortable, paginated, filterable table. `components/data-table/` is a single TanStack Table wrapper (pagination, column visibility, sorting, export) that every module's table component configures with columns, not one that each module reimplements.

---

## 1. Full Tree

```
royal-hardware-erp/
├─ drizzle/                         # generated migrations (drizzle-kit generate output)
│
├─ src/
│  ├─ app/
│  │  ├─ (auth)/
│  │  │  ├─ layout.tsx
│  │  │  └─ login/page.tsx
│  │  │
│  │  ├─ (dashboard)/               # authenticated shell: sidebar, topbar, company/warehouse switcher
│  │  │  ├─ layout.tsx               # RBAC gate reads session, redirects if unauthorized
│  │  │  ├─ dashboard/page.tsx
│  │  │  │
│  │  │  ├─ inventory/
│  │  │  │  ├─ products/{page.tsx, [id]/page.tsx, new/page.tsx}
│  │  │  │  ├─ categories/page.tsx
│  │  │  │  ├─ sub-categories/page.tsx
│  │  │  │  ├─ brands/page.tsx
│  │  │  │  ├─ units/page.tsx
│  │  │  │  ├─ unit-conversions/page.tsx
│  │  │  │  ├─ warehouses/page.tsx
│  │  │  │  ├─ stock/page.tsx
│  │  │  │  ├─ stock-transfers/{page.tsx, [id]/page.tsx, new/page.tsx}
│  │  │  │  ├─ stock-adjustments/{page.tsx, [id]/page.tsx, new/page.tsx}
│  │  │  │  └─ stock-movements/page.tsx
│  │  │  │
│  │  │  ├─ purchases/
│  │  │  │  ├─ local/{page.tsx, [id]/page.tsx, new/page.tsx}
│  │  │  │  ├─ import/{page.tsx, [id]/page.tsx, new/page.tsx}
│  │  │  │  └─ suppliers/{page.tsx, [id]/page.tsx}
│  │  │  │
│  │  │  ├─ sales/
│  │  │  │  ├─ page.tsx
│  │  │  │  ├─ [id]/page.tsx
│  │  │  │  ├─ new/page.tsx
│  │  │  │  ├─ invoices/{page.tsx, [id]/page.tsx}
│  │  │  │  ├─ quotations/{page.tsx, [id]/page.tsx, new/page.tsx}
│  │  │  │  └─ customers/{page.tsx, [id]/page.tsx}
│  │  │  │
│  │  │  ├─ expenses/{page.tsx, new/page.tsx}
│  │  │  ├─ reports/{page.tsx, [reportType]/page.tsx}
│  │  │  ├─ whatsapp/page.tsx
│  │  │  ├─ users/{page.tsx, [id]/page.tsx}
│  │  │  ├─ roles/{page.tsx, [id]/page.tsx}
│  │  │  ├─ audit-logs/page.tsx
│  │  │  └─ settings/{page.tsx, backups/page.tsx}
│  │  │
│  │  ├─ api/
│  │  │  ├─ webhooks/whatsapp/route.ts    # Meta delivery-status callbacks
│  │  │  └─ cron/backup/route.ts          # Vercel Cron trigger
│  │  │
│  │  ├─ layout.tsx
│  │  └─ globals.css
│  │
│  ├─ modules/
│  │  ├─ inventory/
│  │  │  ├─ products/         (components/actions/services/repositories/schemas/types/hooks)
│  │  │  ├─ categories/
│  │  │  ├─ brands/
│  │  │  ├─ units/
│  │  │  ├─ unit-conversions/
│  │  │  ├─ warehouses/
│  │  │  ├─ stock/
│  │  │  ├─ stock-transfers/
│  │  │  ├─ stock-adjustments/
│  │  │  └─ stock-movements/
│  │  ├─ purchases/
│  │  │  ├─ local-purchases/
│  │  │  ├─ import-purchases/
│  │  │  └─ suppliers/
│  │  ├─ sales/
│  │  │  ├─ sales/
│  │  │  ├─ invoices/
│  │  │  ├─ quotations/
│  │  │  └─ customers/
│  │  ├─ expenses/
│  │  ├─ whatsapp/
│  │  ├─ reports/
│  │  ├─ identity/              # users, roles, permissions
│  │  ├─ audit/
│  │  └─ settings/
│  │
│  ├─ components/
│  │  ├─ ui/                    # shadcn/ui primitives
│  │  ├─ layout/                # Sidebar, Topbar, CompanySwitcher, WarehouseSwitcher, Breadcrumbs
│  │  ├─ data-table/            # shared TanStack Table wrapper
│  │  └─ forms/                 # shared RHF+Zod field wrappers
│  │
│  ├─ lib/
│  │  ├─ db/
│  │  │  ├─ schema.ts           # all tables + pgEnums + pgRole('app_user') + pgPolicy (RLS)
│  │  │  ├─ index.ts            # Drizzle client singleton (postgres-js)
│  │  │  ├─ context.ts          # withUserContext(userId, fn) — RLS role/session-var transaction wrapper
│  │  │  └─ seed.ts             # companies, roles/permissions, sales_channels, categories seed
│  │  ├─ supabase/{client.ts, server.ts, middleware.ts}
│  │  ├─ auth/                  # session helpers, requirePermission() guard
│  │  ├─ constants/             # enums mirroring Drizzle pgEnum (statuses, movement types, roles)
│  │  ├─ validation/            # shared Zod primitives (money, phone, sku, gst-rate)
│  │  ├─ utils/                 # currency/date formatting, unit-conversion resolver (FR-UNIT-002)
│  │  └─ audit/log.ts           # shared audit-log writer, called from every service
│  │
│  ├─ hooks/                    # cross-module hooks (usePermission, useCompanyContext)
│  ├─ config/                   # nav config, feature flags
│  └─ middleware.ts             # auth gate at the edge
│
├─ tests/
│  ├─ unit/                     # mirrors modules/ structure
│  ├─ integration/               # DB-backed: posting a sale, transfer variance, etc.
│  └─ e2e/                       # Playwright: golden-path flows per module
│
├─ .env.example
├─ drizzle.config.ts               # dialect: postgresql, schema: src/lib/db/schema.ts, out: drizzle/
├─ next.config.ts
├─ tailwind.config.ts
├─ tsconfig.json
└─ package.json
```

## 2. Naming Conventions

- Folders: `kebab-case` (`stock-transfers`, `import-purchases`).
- Components: `PascalCase.tsx` (`ProductForm.tsx`).
- Services/repositories/hooks: `camelCase.ts` (`productService.ts`, `useProducts.ts`).
- Route groups `(auth)` / `(dashboard)` organize layouts without affecting the URL.
- Drizzle `pgEnum` names map 1:1 to `lib/constants` TS union types (e.g. `StockMovementType`), never re-declared as ad-hoc string literals in a module.

## 3. Company/Warehouse Context

A `CompanyProvider`/`WarehouseProvider` React context (backed by a cookie so it survives refresh) holds the currently-selected Company and Warehouse for the session, exposed via `useCompanyContext()`/`useWarehouseContext()` in `src/hooks/`. Server Actions re-validate this against `user_company_access`/`user_warehouse_access` server-side on every call — the client-side context is for UX (what's shown in the switcher), never trusted as the access-control decision itself.

---

**Next Step:** On approval, proceed to **Phase 6 — UI Wireframes**, sketching the key screens (Dashboard, Product list/detail, Sale/Invoice creation, Stock Transfer flow) before any API or component code is written.
