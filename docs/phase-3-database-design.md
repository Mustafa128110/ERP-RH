# Royal Hardware ERP — Database Design

**Phase:** 3 of 12
**Status:** Draft for approval — **superseded from the original bespoke-table design to match the actual schema in [`docs/db/Royal_Hardware_ERP_SQL.md`](db/Royal_Hardware_ERP_SQL.md)**
**Depends on:** [Phase 2 — Functional Requirements Specification](phase-2-functional-requirements.md)

This is the **logical data model**, rewritten to document the schema actually defined in `docs/db/Royal_Hardware_ERP_SQL.md` rather than the earlier bespoke per-module design. The physical Drizzle schema (`lib/db/schema.ts`) started ahead of Phase 9 to unblock login — see §1a — and is applied to the live Supabase database; Phase 4 turns this into a visual ER diagram from these same tables.

**This version is a different architecture from the original draft**, not a tweak: instead of one table per business object (`purchases`, `sales`, `quotations`, `stock_transfers`, `stock_adjustments`, `invoices`...), the actual schema uses **two universal tables** (`documents` + `document_lines`) for every transaction type, differentiated by a `document_types` lookup row. Customers and Suppliers are likewise unified into one `contacts` table, and Products/Warehouses become `items`/`locations`. Section 8 lists everywhere this diverges from the Phase 1/2 requirements so the gap is visible before Phase 9 rather than discovered during implementation.

---

## 0. Cross-Cutting Design Decisions (as implemented in the SQL)

### 0.1 One universal transaction pair, not one table per document type

Every business transaction — Local Purchase, Import Purchase, Sale, Quotation, Stock Transfer, Stock Adjustment, Purchase Return, Sales Return, Invoice — is a row in `documents`, with its type-specific behavior driven entirely by a `document_types` lookup row (`affects_inventory`, `affects_accounting`, `affects_receivable`, `affects_payable`, `positive_stock`) rather than a bespoke table per business object. `document_lines` holds every line item for every document type. This is a config-driven pattern: adding a new transaction type (e.g. a future document kind) is a `document_types` insert, not a migration.

### 0.2 Contacts unify Customers and Suppliers

`contacts.contact_type` (`customer`\|`supplier`\|`both`\|`employee`\|`transporter`\|`other`) replaces the separate `customers`/`suppliers` tables from the original draft. A business that is both a customer and a supplier is one row, not two.

### 0.3 Stock-on-hand is computed, not cached

Unlike the original draft's `stock_balances` cache table, this schema has **no balance cache**. Stock-on-hand for an item at a location is `SUM(inventory_transactions.movement * inventory_transactions.base_quantity)` filtered by item/location, joined through `document_lines`. See §8.3 for why this is flagged as an open item rather than accepted as-is.

### 0.4 Accounting is real double-entry, not per-module ledgers

`chart_of_accounts` + `ledger_entries` (debit/credit, `CHECK` enforcing exactly one side per row) replace the original draft's separate `customer_ledger_entries`/`supplier_ledger_entries` tables. A contact's ledger is derived by joining `ledger_entries → documents` where `documents.contact_id` = the contact — there is no ledger table keyed directly by contact.

### 0.5 Company scoping

`documents.company_id` scopes every transaction to Royal Hardware or M52, same principle as the original draft. **Unlike** the original draft, `contacts.company_id` is a single required FK (not nullable, not a per-company balance join table) — see §8.1, this is the most significant divergence from the BRD's shared-master-data requirement.

### 0.6 Company scoping was extended to almost every table (implemented ahead of Phase 9)

Originally only `contacts`, `items`, `locations` (nullable), `documents`, `chart_of_accounts`, `price_lists`, `settings` carried `company_id`. By explicit instruction, this was extended to every table that plausibly needs per-company data, on the reasoning that a shared reference table (one tax list, one unit list) doesn't actually work once Royal Hardware and M52 need different rates/units/categories. This **doubles down** on the §8.1 divergence rather than resolving it — see §8.1's update below.

**Tables that gained `company_id` in this pass** (all `NOT NULL` except where noted), each now RLS-enabled with a `company_scope` policy identical in shape to §1a's:
- Former "shared lookup" tables, now per-company: `categories`, `brands`, `units`, `taxes`, `payment_methods`, `expense_categories`, `document_types`, `currencies`. Their old global-uniqueness constraints (`brands.name UNIQUE`, `currencies.code UNIQUE`, etc.) became `UNIQUE(company_id, <column>)` — two companies can now both have a "USD" currency or an "Electronics" category, as separate rows.
- Child/transaction tables that previously only had a company via a join to their parent: `document_lines`, `inventory_transactions`, `ledger_entries`, `item_images`, `unit_conversions` (all `NOT NULL` — matches their non-nullable parent). `attachments` (nullable — matches `attachments.document_id` being nullable).

**Tables deliberately left alone** (with the reasoning, since "every table" doesn't mean literally every table):
- `companies` — it *is* the company; scoping it to itself is meaningless. It now has a genuine FK cycle with `currencies` (a company's default `currency_id` is one of its own now-per-company `currencies` rows) — see the `AnyPgColumn` annotation in `lib/db/schema.ts`, same pattern as the existing self-referencing FKs.
- `users`, `roles`, `permissions`, `role_permissions`, `user_company_access`, `user_warehouse_access` — deliberately **not** given `company_id`. A user already supports multi-company access via `user_company_access` (many-to-many); forcing a single `company_id` onto `users` would contradict that. `roles` stay a shared/global catalog (one "Admin", not one per company) — see §1a for where the actual per-company distinction lives instead: `user_roles.company_id`.
- `audit_log` — got a **nullable** `company_id` for filtering, but deliberately **no RLS** (§8.6: audit access is gated by `requirePermission('audit','view')` at the app layer, not row-level scoping).

---

## 1. Identity & Companies

| Table | Key Columns | Notes |
|---|---|---|
| `companies` | id (PK, uuid), name, short_name, currency_id (FK→currencies), phone, email, website, tax_number, address, created_at | Seed: Royal Hardware, M52 |
| `currencies` | id (PK), code (unique), symbol, name | Supports multi-currency if a future company needs it |
| `users` | id (PK), supabase_auth_id (uuid, **unique, NOT NULL**), name, email (unique, NOT NULL), status (enum: `active`\|`inactive`\|`locked`), created_at | **Implemented per Phase 8**, ahead of the rest of Phase 9: the old free-text `role`/plaintext-`password` columns (previously flagged here) are dropped entirely. `supabase_auth_id` links each row to Supabase Auth's own `auth.users` — password lives there, never in this schema. Roles/permissions moved to data-driven tables, §1a. |

## 1a. Roles, Permissions & Access (Phase 8 — RBAC)

Implemented ahead of Phase 9 so login/authorization exist before the rest of the backend does. Resolves the old §8.6 divergence (a free-text `role` column with no permissions model).

| Table | Key Columns | Notes |
|---|---|---|
| `roles` | id (PK), name (unique), created_at | Seed: **Admin**, **Salesman** (FR-USER-003) |
| `permissions` | id (PK), module, action, UNIQUE(module, action) | Fixed code-defined catalog (`lib/db/seed-rbac.ts`) — `module.action` pairs like `sales.create`, `stock.view`. Only role→permission assignment is meant to be UI-editable (Settings → Roles, Phase 6/Phase 7 §1.10), not the catalog itself |
| `role_permissions` | role_id (FK, CASCADE), permission_id (FK, CASCADE), PK(role_id, permission_id) | Admin gets every permission; Salesman gets exactly the FR-USER-003 matrix (`sales`/`invoices`/`quotations`/`customers` view+create, `stock` view) |
| `user_roles` | id (PK, uuid), user_id (FK, CASCADE), role_id (FK, CASCADE), company_id (FK, CASCADE, **nullable**), UNIQUE(user_id, role_id, company_id) | A user may hold multiple roles (FR-USER-001) — **and a different role per company**: `company_id IS NULL` means the role applies globally (every company in `user_company_access`); a set value scopes it to just that one company. E.g. Admin globally + Salesman only in M52 is two rows. Effective permissions for company X = union of the NULL-company rows and the company=X rows (`lib/auth/session.ts`) |
| `user_company_access` | user_id (FK, CASCADE), company_id (FK, CASCADE), PK(user_id, company_id) | Backs `requirePermission(..., {companyId})` and the RLS `company_scope` policies (§ below) |
| `user_warehouse_access` | user_id (FK, CASCADE), location_id (FK, CASCADE), PK(user_id, location_id) | "Warehouse" = a `locations` row (§0's unification). Backs `requirePermission(..., {warehouseId})` and the `locations` RLS policy |

**Row Level Security:** every table that carries a `company_id` column has RLS enabled with a `company_scope` policy — as of §0.6 that's 21 tables (`chart_of_accounts`, `contacts`, `documents`, `items`, `locations`, `price_lists`, `settings`, `categories`, `brands`, `units`, `taxes`, `payment_methods`, `expense_categories`, `document_types`, `currencies`, `document_lines`, `inventory_transactions`, `ledger_entries`, `item_images`, `unit_conversions`, `attachments`) — `locations` and `attachments` additionally allow a NULL `company_id` (shared location / non-document attachment) through. A non-bypass `app_user` Postgres role (`pgRole` in `lib/db/schema.ts`) is what these policies apply to; `lib/db/context.ts`'s `withUserContext(userId, fn)` does `SET LOCAL ROLE app_user` + `set_config('app.user_id', ...)` inside a transaction so `current_setting('app.user_id', true)` resolves. Every other table (`users`, `roles`, `permissions`, `role_permissions`, `user_roles`, `user_company_access`, `user_warehouse_access`, `audit_log`, `companies`) has RLS explicitly disabled — Supabase enables RLS by default on every new `public` table regardless of what Drizzle asks for, so this was a real migration (`drizzle/0003_disable_rls_on_unscoped_tables.sql`, extended by `0006`), not a no-op. See `docs/phase-8-authentication.md` §4 for the full mechanism and why it's needed at all (Drizzle's direct Postgres connection bypasses RLS otherwise).

## 2. Contacts & Shared Lookups

| Table | Key Columns | Notes |
|---|---|---|
| `contacts` | id (PK), company_id (FK, **NOT NULL**), code (unique), display_name, company_name, contact_type (enum), phone, whatsapp, email, address, city, country, tax_number, credit_limit, is_active, created_at | Replaces Customers + Suppliers (§0.2). `company_id NOT NULL` means a contact belongs to exactly one company — see §8.1 |
| `categories` | id (PK), parent_id (FK, self), name, slug (unique) | Self-referencing, so "Sub-Category" is just a `categories` row with a `parent_id` — no separate `sub_categories` table |
| `brands` | id (PK), name (unique), country | |
| `units` | id (PK), name, symbol, is_base | |
| `unit_conversions` | id (PK), item_id (FK→items, added via `ALTER TABLE` after `items` exists), from_unit_id (FK), to_unit_id (FK), multiplier, UNIQUE(item_id, from_unit_id, to_unit_id) | Per-item conversion factors (matches FR-UNIT-003) |
| `taxes` | id (PK), name, rate, is_active | Flat lookup — no per-category default rate column (see §8.5) |
| `payment_methods` | id (PK), name (unique), is_active | |
| `expense_categories` | id (PK), name (unique), description | |
| `price_lists` | id (PK), company_id (FK), name, is_default, created_at | **Created but never referenced by any other table — no `price_list_items`, no FK from `items` or `document_lines`. Currently a dead table; see §8.7.** |

## 3. Items & Locations

| Table | Key Columns | Notes |
|---|---|---|
| `items` | id (PK), company_id (FK), sku (unique), barcode, name, urdu_name, category_id (FK), brand_id (FK), purchase_unit_id/sales_unit_id/base_unit_id (FK→units), minimum_stock, reorder_level, purchase_price, selling_price, taxable, is_active, created_at | Replaces `products`. **`company_id` is required here too** — same shared-master-data conflict as contacts (§8.1). `minimum_stock`/`reorder_level` are single global values, not per-location (§8.4) |
| `item_images` | id (PK), item_id (FK, CASCADE), image_url, is_primary, sort_order | |

Indexes: `items(name)`, `items(sku)`, `items(category_id)`, `items(brand_id)`, `item_images(item_id)`.

| Table | Key Columns | Notes |
|---|---|---|
| `locations` | id (PK), company_id (FK, nullable), code (unique), name, location_type (enum: `shop`\|`warehouse`\|`transit`\|`damaged`\|`reserved`) | Replaces `warehouses`. Adds `damaged`/`reserved` as first-class location types instead of a status flag on stock |

## 4. Documents — the Universal Transaction Model

| Table | Key Columns | Notes |
|---|---|---|
| `document_types` | id (PK, smallserial), code (unique), name, affects_inventory, affects_accounting, affects_receivable, affects_payable, positive_stock (nullable bool), active | Seed rows drive behavior, e.g. `SALE` → affects_inventory + affects_accounting + affects_receivable, positive_stock = false; `PURCHASE` → positive_stock = true; `STOCK_ADJUSTMENT` → affects_inventory only |
| `documents` | id (PK), company_id (FK), document_type_id (FK), number, series, revision, status (enum: `draft`\|`pending`\|`approved`\|`posted`\|`cancelled`), document_date, posting_date, contact_id (FK, nullable), currency_id (FK), exchange_rate, subtotal, discount_total, tax_total, shipping_total, grand_total, notes, created_by, approved_by, cancelled_by, created_at, updated_at, UNIQUE(company_id, document_type_id, number) | One row per Purchase, Sale, Quotation, Transfer, Adjustment, Return, Invoice — the `document_type_id` is what a Purchase *is*, not a separate table |
| `document_lines` | id (PK), document_id (FK, CASCADE), line_no, item_id (FK, nullable), description, location_id (FK), unit_id (FK), quantity, base_quantity, unit_price, unit_cost, discount_percent, discount_amount, tax_id (FK), tax_amount, line_total, sort_order, UNIQUE(document_id, line_no) | One row per line, for every document type. `location_id` is per-line, singular |

Indexes: `documents(document_date)`, `documents(contact_id)`, `documents(status)`, `document_lines(document_id)`, `document_lines(item_id)`, `document_lines(location_id)`.

**What this means for Phase 2's per-module requirements:** a Local Purchase is a `documents` row with `document_type_id` → the `LOCAL_PURCHASE` type; its lines are `document_lines` rows. An Invoice (FR-INV-001, "printable face of a posted Sale, not a separate financial record") is naturally satisfied here — it can be the *same* `documents` row as the Sale once posted, with no separate `invoices` table needed. A Quotation is a `documents` row with `document_type_id` → `QUOTATION` and `status = draft/pending/...`. **Converting a Quotation to a Sale/Invoice has no modeled link** — see §8.2, this is the largest functional gap versus FR-QUO-002.

## 5. Inventory Ledger

| Table | Key Columns | Notes |
|---|---|---|
| `inventory_transactions` | id (PK), document_line_id (FK→document_lines, RESTRICT), movement (smallint, `CHECK IN (-1,1)`), quantity, base_quantity, unit_cost, total_cost, created_at | **Append-only** — the actual stock ledger. `movement` is the sign; `document_lines.location_id` (via the parent line) supplies *where* |

Index: `inventory_transactions(document_line_id)`.

Stock-on-hand for (item, location) = `SUM(it.movement * it.base_quantity) FROM inventory_transactions it JOIN document_lines dl ON dl.id = it.document_line_id WHERE dl.item_id = ? AND dl.location_id = ?`. No materialized/cached balance exists in this schema (§0.3, §8.3).

## 6. Accounting

| Table | Key Columns | Notes |
|---|---|---|
| `chart_of_accounts` | id (PK), company_id (FK), parent_id (FK, self), code, name, account_type, is_posting, is_active, UNIQUE(company_id, code) | Standard COA tree, per company |
| `ledger_entries` | id (PK), document_id (FK), account_id (FK), debit, credit, created_at, `CHECK ((debit=0 AND credit>0) OR (credit=0 AND debit>0))` | **Append-only** double-entry. A contact's ledger/statement is `ledger_entries JOIN documents ON documents.id = ledger_entries.document_id WHERE documents.contact_id = ?` |

## 7. Attachments, Audit & Settings

| Table | Key Columns | Notes |
|---|---|---|
| `attachments` | id (PK), document_id (FK, CASCADE), file_name, file_url, mime_type, uploaded_at | Generic file attachment for any document (receipt photos, scanned invoices, etc.) |
| `audit_log` | id (PK), table_name, record_id, action, old_values (jsonb), new_values (jsonb), changed_by, changed_at | **Append-only.** No `ip_address`/`user_agent`/`reason` columns — narrower than FR-AUDIT-001 (§8.6) |
| `settings` | id (PK), company_id (FK, **NOT NULL**), key, value (text), UNIQUE(company_id, key) | `company_id` is required here, so there is no slot for a truly global (cross-company) setting |

## 7a. Views

| View | Reads | Notes |
|---|---|---|
| `rate_list` | `items`, `document_lines`, `documents`, `document_types` | Last 3 `PURCHASE_INVOICE` unit prices + dates per item (rolling rate history). Hand-written custom migration (`drizzle/0007_create_rate_list_view.sql`), not a typed Drizzle view — see full SQL and RLS caveat in [`docs/db/Royal_Hardware_ERP_SQL.md`](db/Royal_Hardware_ERP_SQL.md#views). Returns all-NULL rate/date columns until a `document_types` row with `code = 'PURCHASE_INVOICE'` is seeded (§0.6: `document_types` is per-company and currently empty). |

---

## 8. Divergences from Phase 1 (BRD) / Phase 2 (FRS)

These are not stylistic differences — each one changes what the app can actually do versus what Phase 1/2 promised the business. Listed so they're resolved by design decision (schema change, or requirement change) before Phase 9, not discovered mid-build.

### 8.1 Contacts and Items are not shared master data (BRD §2, §6.2; FR-SUP-001, FR-CUST-001, FR-PROD-003)

`contacts.company_id` and `items.company_id` are both `NOT NULL` single FKs. The BRD is explicit that Products, Customers, and Suppliers are **shared** across Royal Hardware and M52 with *separate per-company balances/ledgers* — this schema instead ties every contact and every item to exactly one company, meaning the same supplier or product used by both companies would need to be duplicated as two rows. This is the single biggest conflict with the BRD and needs a decision: either (a) make `company_id` nullable/removed on `contacts`/`items` and reintroduce a per-company balance join table (the original draft's approach), or (b) confirm with the business that Products/Customers/Suppliers are in fact meant to be company-specific, contradicting BRD §2.

**Update (§0.6):** by explicit instruction this direction was extended rather than reversed — `categories`, `brands`, `units`, `taxes`, `payment_methods`, `expense_categories`, `document_types`, and `currencies` (previously genuinely shared/global lookups, no `company_id` at all) now also carry a required `company_id`. If (b) turns out to be the wrong call for contacts/items, it's very likely the wrong call for these too, since they're the same "shared master data" category the BRD is talking about — resolve §8.1 and this extension together, not separately.

### 8.2 No link from a Quotation to the Sale it converted into (FR-QUO-002)

`documents` has no `source_document_id`/`parent_document_id` column and there is no join table. Partial conversion (a subset of quoted line items becoming a Sale, quotation remains open for the rest) has no representable state at all — `document_lines` has no "converted quantity" column either. Needs either a self-referencing FK on `documents` or a `document_relations(from_document_id, to_document_id, relation_type)` table before Phase 9.

### 8.3 No stock balance cache (§0.3; FR-STK-001/FR-WH-002 performance implication)

Every stock-on-hand read is a `SUM()` over the full `inventory_transactions` history. Functionally correct, but the original draft called this out specifically as not scaling. Either accept the recompute cost (fine at Royal Hardware's transaction volume, cheap with the indexes already defined) or add a maintained `item_location_balances` cache table written transactionally alongside each `inventory_transactions` insert.

### 8.4 No per-location stock thresholds (FR-PROD-008)

`items.minimum_stock`/`reorder_level` are single global values. FR-PROD-008 requires thresholds *per warehouse per product* ("low stock in Shop but fine in Warehouse"). Needs an `item_location_thresholds(item_id, location_id, min_stock, max_stock)` table.

### 8.5 No Sales Channels (FR-SALE-001/002)

There is no `sales_channels` table and no column anywhere recording SHOP/WEB/M52/BALOCHISTAN. `document_type_id` distinguishes *what kind* of document, not *which channel* it was sold through. A channel concept — and its mapping to a company for ledger/GST purposes — needs to be added, likely as a lookup table referenced from `documents` (or folded into `document_types` if channels are modeled as more granular document types).

### 8.6 Narrower Users/Audit than FR-USER/FR-AUDIT — **users/roles half resolved by Phase 8, audit still open**

- ~~`users` has no auth linkage... `role` is a free-text varchar~~ — **resolved**: `users.supabase_auth_id` links to Supabase Auth, and `roles`/`permissions`/`role_permissions`/`user_roles` (§1a) make roles and permissions data-driven per FR-USER-002/003.
- ~~`users.password` is stored as a raw `VARCHAR(50)`...~~ — **resolved**: the column is gone; Supabase Auth owns credentials entirely (docs/phase-8-authentication.md §1).
- `audit_log` is still missing `ip_address`, `user_agent`, and `reason` — all required by FR-AUDIT-001 (reason is mandatory for Deletes/Adjustments). Not addressed by the Phase 8 work.

### 8.7 No WhatsApp, Backups, or Warehouse-transfer/adjustment workflow modeling

- No `whatsapp_templates`/`whatsapp_messages_log` — the entire WhatsApp module (FR-WA-001–004) has no schema representation.
- No `backups` table — FR-BAK-001/002 unrepresented.
- `document_status` (`draft`\|`pending`\|`approved`\|`posted`\|`cancelled`) has no transfer-specific states — FR-XFER-002's `Initiated → In Transit → Received` (or `Rejected`) workflow, and the "two linked movements sharing one reference" requirement (FR-XFER-001), aren't directly expressible with a single `documents` row and generic status enum. Needs either extra `document_status` values plus a documented convention for transfer's two inventory legs, or a dedicated extension table (mirroring how `purchase_import_details` used to extend `purchases`).
- `price_lists` is defined but unused (§2) — either wire it to `items`/`document_lines` (multi-tier pricing, FR-PROD-007) or drop it.

---

## Cascade Rules (as implemented)

- `document_lines.document_id` → `documents(id)` **ON DELETE CASCADE**.
- `item_images.item_id` → `items(id)` **ON DELETE CASCADE**.
- `attachments.document_id` → `documents(id)` **ON DELETE CASCADE**.
- `inventory_transactions.document_line_id` → `document_lines(id)` **ON DELETE RESTRICT** — an inventory-affecting line cannot be deleted once posted.
- All other FKs are default (RESTRICT) — master data referenced by a transaction cannot be deleted out from under it.

---

## Open Items Carried Into Phase 4/9

- Six of the seven items in §8 still need an explicit decision (accept as designed, or schema change) before Phase 9 fully starts — §8.6 is now half-resolved (users/roles; audit fields still open).
- Numbering (`documents.number` scoped by `UNIQUE(company_id, document_type_id, number)`) — confirm this still matches how Royal Hardware/M52 number documents today, so migrated history doesn't collide.
- No `companies` rows exist yet (Royal Hardware, M52 seed data from §1's "Seed" note hasn't been inserted) — `user_company_access` can't be populated for real until that happens.

---

**Next Step:** On approval, proceed to **Phase 4 — ER Diagram**, producing a visual entity-relationship diagram from this model.
