# Royal Hardware ERP — Database Reference

The authoritative description of the schema. Generated from `lib/db/schema.ts`
(via `npx drizzle-kit export --sql`) and organised by concern, so it can be read
top to bottom and also executed top to bottom against an empty database.

**`lib/db/schema.ts` is the source of truth.** Drizzle owns the migrations in
`drizzle/`; this file documents what they produce. If you change the schema,
change it there and regenerate:

```bash
npx drizzle-kit generate     # writes a migration
npx drizzle-kit migrate      # applies it
npx drizzle-kit export --sql # re-derive the SQL in this document
```

Ordering note: every table is created first, then foreign keys, then indexes,
then policies. That is deliberate — it lets tables reference each other in
cycles (`documents` ↔ `cheque_register`) without needing a specific creation
order.

---

## 1. How the data flows

Everything transactional is one shape. Purchases, sales, quotations, payments,
transfers and adjustments are **not** separate tables — they are all rows in
`documents`, distinguished by `document_type_id`. A document's *type* decides
what its posting does:

| Flag on `document_types` | Effect when the document posts |
| --- | --- |
| `affects_inventory` | writes `inventory_transactions` rows (stock moves) |
| `affects_accounting` | writes `ledger_entries` rows (debit/credit) |
| `affects_receivable` | the customer owes us |
| `affects_payable` | we owe the supplier |
| `positive_stock` | direction of the stock movement, when it isn't implied |

The path a transaction takes:

```
                          companies  (every scoped table hangs off this)
                              │
        ┌─────────────────────┼──────────────────────┐
        │                     │                      │
    contacts               items ── categories    locations
   (customer/               │   └── brands            │
    supplier)               │   └── unit_conversions ─┴── units
        │                   │
        └────────┬──────────┘
                 ▼
            documents ──────────── document_types  (what kind, and what it posts)
                 │                        ▲
                 │                        │
                 │                 document_number_ledger
                 │                 (record of every number issued;
                 │                  numbers allocated by number_sequences)
                 ▼
          document_lines  (one row per product on the document)
                 │
        ┌────────┴────────┐
        ▼                 ▼
 inventory_transactions  ledger_entries
   (stock movement,       (debit / credit,
    ±1 × base_quantity)    money owed)

  Settlement — how a document was actually paid:
    documents.bank_account_id ─→ bank_accounts
    documents.cash_account_id ─→ cash_accounts
    cheque_register.document_id ─→ documents      (a cheque settles one document)
    expenses.cheque_id          ─→ cheque_register (or one expense)
```

**Stock on hand is derived, never stored.** It is
`SUM(movement × base_quantity)` over `inventory_transactions` for an item,
grouped by location and unit (`lib/actions/stock.ts`). There is no
`quantity_on_hand` column to drift out of sync.

**Expenses sit outside `documents`.** They are their own table because they have
no lines, no contact and no inventory effect — just a category, an amount and a
settlement. This is why "is this cheque free?" has to check both
`cheque_register.document_id` and `expenses.cheque_id`.

**Numbers come from `number_sequences`.** One counter row per scope, incremented
atomically. Document numbers additionally get a permanent record in
`document_number_ledger`, which is never deleted from — so a deleted invoice
never has its number reissued. See §7.

---

## 2. Extensions, enums and roles

Enums are created before the tables that use them. `document_status` is defined
once, in lower case, matching `lib/db/schema.ts`.

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE "public"."contact_type"  AS ENUM ('customer','supplier','both','employee','transporter','other');
CREATE TYPE "public"."location_type" AS ENUM ('shop','warehouse','transit','damaged','reserved');
CREATE TYPE "public"."user_status"   AS ENUM ('active','inactive','locked');

CREATE TYPE "public"."document_status" AS ENUM ('draft','pending','approved','posted','cancelled');

CREATE TYPE "public"."document_type_code" AS ENUM (
    'PURCHASE_INVOICE','PURCHASE_RETURN','PURCHASE_ORDER',
    'SALES_INVOICE','SALES_RETURN','SALES_ORDER','QUOTATION',
    'STOCK_TRANSFER','STOCK_ADJUSTMENT','STOCK_OPENING',
    'PAYMENT_RECEIVED','PAYMENT_MADE','JOURNAL_ENTRY','EXPENSE',
    'DELIVERY_NOTE','GOODS_RECEIPT','CREDIT_NOTE','DEBIT_NOTE'
);

CREATE TYPE "public"."document_series" AS ENUM (
    'PI','PR','PO','SI','SR','SO','QT','ST','SA','OS',
    'RC','PM','JE','EX','DN','GR','CN','DB'
);

CREATE TYPE "public"."document_type_name" AS ENUM (
    'Purchase Invoice','Purchase Return','Purchase Order',
    'Sales Invoice','Sales Return','Sales Order','Quotation',
    'Stock Transfer','Stock Adjustment','Stock Opening',
    'Payment Received','Payment Made','Journal Entry','Expense',
    'Delivery Note','Goods Receipt','Credit Note','Debit Note'
);

CREATE TYPE "public"."cheque_type"   AS ENUM ('ACCOUNT_PAYEE','BEARER','CROSS','OPEN','POST_DATED');
CREATE TYPE "public"."cheque_status" AS ENUM ('RECEIVED','ISSUED','IN_HAND','DEPOSITED','CLEARED','RETURNED','CANCELLED','VOID');

-- The non-BYPASSRLS role the RLS policies in §9 are written against.
CREATE ROLE "app_user";
```

> `document_type_name` is declared but unused — `document_types.name` is a plain
> `varchar(100)`. Kept because the type exists in the live database; see §10.

---

## 3. Tenancy and access control

`companies` is the tenant root. Nearly every other table carries a `company_id`,
and the RLS policies in §9 scope reads to the companies a user can see.

`users` holds the application profile; credentials live in Supabase Auth, linked
by `supabase_auth_id`. There is no password column.

```sql
CREATE TABLE "companies" (
    "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "name"       varchar(200) NOT NULL,
    "short_name" varchar(50),
    "phone"      varchar(30),
    "email"      varchar(150),
    "website"    text,
    "tax_number" varchar(100),
    "address"    text,
    "created_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE "users" (
    "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "supabase_auth_id" uuid NOT NULL,
    "name"             varchar(100) NOT NULL,
    "email"            varchar(150) NOT NULL,
    "status"           "user_status" DEFAULT 'active' NOT NULL,
    "created_at"       timestamp with time zone DEFAULT now(),
    CONSTRAINT "users_supabase_auth_id_unique" UNIQUE("supabase_auth_id"),
    CONSTRAINT "users_email_unique" UNIQUE("email")
);

CREATE TABLE "roles" (
    "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "name"       varchar(100) NOT NULL,
    "created_at" timestamp with time zone DEFAULT now(),
    CONSTRAINT "roles_name_unique" UNIQUE("name")
);

-- Fixed catalogue of module+action pairs, seeded by lib/db/seed-rbac.ts.
CREATE TABLE "permissions" (
    "id"     uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "module" varchar(100) NOT NULL,
    "action" varchar(50) NOT NULL,
    CONSTRAINT "permissions_module_action_unique" UNIQUE("module","action")
);

CREATE TABLE "role_permissions" (
    "role_id"       uuid NOT NULL,
    "permission_id" uuid NOT NULL,
    CONSTRAINT "role_permissions_role_id_permission_id_pk" PRIMARY KEY("role_id","permission_id")
);

-- company_id NULL means the role applies in every company the user can access;
-- a value scopes it to that one company. A user's effective permissions in
-- company X are the union of their NULL-company roles and their company=X roles.
CREATE TABLE "user_roles" (
    "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "user_id"    uuid NOT NULL,
    "role_id"    uuid NOT NULL,
    "company_id" uuid,
    CONSTRAINT "user_roles_user_id_role_id_company_id_unique" UNIQUE("user_id","role_id","company_id")
);

CREATE TABLE "user_company_access" (
    "user_id"    uuid NOT NULL,
    "company_id" uuid NOT NULL,
    CONSTRAINT "user_company_access_user_id_company_id_pk" PRIMARY KEY("user_id","company_id")
);

-- "Warehouse" here is a locations row; warehouses were unified into locations.
CREATE TABLE "user_warehouse_access" (
    "user_id"     uuid NOT NULL,
    "location_id" uuid NOT NULL,
    CONSTRAINT "user_warehouse_access_user_id_location_id_pk" PRIMARY KEY("user_id","location_id")
);
```

---

## 4. Master data

`contacts` and `locations` allow `company_id` to be NULL, meaning "shared across
every company". `bank_accounts` does the same.

```sql
CREATE TABLE "contacts" (
    "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "code"            varchar(30),
    "company_id"      uuid,
    "display_name"    varchar(200) NOT NULL,
    "company_name"    varchar(200),
    "contact_type"    "contact_type" NOT NULL,
    "phone"           varchar(30),
    "alternate_phone" varchar(30),
    "whatsapp"        varchar(30),
    "email"           varchar(150),
    "address"         text,
    "city"            varchar(100),
    "country"         varchar(100),
    "tax_number"      varchar(100),
    "credit_limit"    numeric(18,2) DEFAULT '0',
    "is_active"       boolean DEFAULT true,
    "created_at"      timestamp with time zone DEFAULT now(),
    CONSTRAINT "contacts_code_unique" UNIQUE("code")
);

-- Global reference table (no company_id): a warehouse/shop is shared across companies.
CREATE TABLE "locations" (
    "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "code"          varchar(30),
    "name"          varchar(150) NOT NULL,
    "location_type" "location_type" NOT NULL,
    CONSTRAINT "locations_code_unique" UNIQUE("code")
);

-- Global reference table (no company_id).
CREATE TABLE "currencies" (
    "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "code"       varchar(10) NOT NULL,
    "symbol"     varchar(10),
    "name"       varchar(100) NOT NULL,
    CONSTRAINT "currencies_code_unique" UNIQUE("code")
);

-- Global reference table (no company_id).
CREATE TABLE "taxes" (
    "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "name"       varchar(100) NOT NULL,
    "rate"       numeric(8,4) DEFAULT '0' NOT NULL,
    "is_active"  boolean DEFAULT true NOT NULL
);

-- Units are global: a kilogram is a kilogram in every company.
CREATE TABLE "units" (
    "id"      uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "name"    varchar(50) NOT NULL,
    "symbol"  varchar(20) NOT NULL,
    "is_base" boolean DEFAULT false
);

CREATE TABLE "expense_categories" (
    "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "company_id"  uuid NOT NULL,
    "name"        varchar(100) NOT NULL,
    "description" text,
    CONSTRAINT "expense_categories_company_id_name_unique" UNIQUE("company_id","name")
);

CREATE TABLE "price_lists" (
    "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "company_id" uuid NOT NULL,
    "name"       varchar(100) NOT NULL,
    "is_default" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE "settings" (
    "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "company_id" uuid NOT NULL,
    "key"        varchar(100) NOT NULL,
    "value"      text,
    CONSTRAINT "settings_company_id_key_unique" UNIQUE("company_id","key")
);
```

---

## 5. Product catalogue

`items.sku` is globally unique, not per company — which is what lets the shared
`RH-#####` counter in §7 hand out one number space for the whole business.

```sql
-- Global reference table (no company_id).
CREATE TABLE "categories" (
    "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "parent_id"  uuid,                        -- self-referencing tree
    "name"       varchar(150) NOT NULL,
    "slug"       varchar(150),
    CONSTRAINT "categories_slug_unique" UNIQUE("slug")
);

-- Global reference table (no company_id).
CREATE TABLE "brands" (
    "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "name"       varchar(150) NOT NULL,
    "country"    varchar(100),
    CONSTRAINT "brands_name_unique" UNIQUE("name")
);

CREATE TABLE "items" (
    "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "company_id"  uuid NOT NULL,
    "sku"         varchar(100) NOT NULL,      -- RH-00042, from number_sequences
    "barcode"     varchar(100),
    "name"        varchar(255) NOT NULL,
    "alias"       varchar(255),
    "urdu_name"   varchar(255),
    "category_id" uuid,
    "brand_id"    uuid,
    "taxable"     boolean DEFAULT false,
    "is_active"   boolean DEFAULT true,
    "created_at"  timestamp with time zone DEFAULT now(),
    CONSTRAINT "items_sku_unique" UNIQUE("sku")
);

CREATE TABLE "item_images" (
    "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "company_id" uuid NOT NULL,
    "item_id"    uuid NOT NULL,
    "image_url"  text NOT NULL,
    "is_primary" boolean DEFAULT false,
    "sort_order" integer DEFAULT 0
);

-- How many of from_unit make one to_unit, for this item (12 pieces = 1 dozen).
CREATE TABLE "unit_conversions" (
    "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "company_id"   uuid,                      -- NULL = global; the default
    "item_id"      uuid NOT NULL,
    "from_unit_id" uuid NOT NULL,
    "to_unit_id"   uuid NOT NULL,
    "multiplier"   numeric(18,6) NOT NULL,
    CONSTRAINT "unit_conversions_item_id_from_unit_id_to_unit_id_unique" UNIQUE("item_id","from_unit_id","to_unit_id"),
    CONSTRAINT "unit_conversions_multiplier_check" CHECK ("unit_conversions"."multiplier" > 0)
);
```

---

## 6. Documents — the universal transaction model

```sql
-- One row per (company, document kind). The boolean flags are what make a
-- posting do something; see the table in §1.
CREATE TABLE "document_types" (
    "id"                 smallint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    "company_id"         uuid NOT NULL,
    "code"               "document_type_code" NOT NULL,
    "name"               varchar(100) NOT NULL,
    "series"             "document_series" NOT NULL,
    "affects_inventory"  boolean DEFAULT false NOT NULL,
    "affects_accounting" boolean DEFAULT false NOT NULL,
    "affects_receivable" boolean DEFAULT false NOT NULL,
    "affects_payable"    boolean DEFAULT false NOT NULL,
    "positive_stock"     boolean,
    "active"             boolean DEFAULT true NOT NULL,
    -- Both scoped by company, so each company runs its own SI-0001 series.
    CONSTRAINT "document_types_company_id_code_unique"   UNIQUE("company_id","code"),
    CONSTRAINT "document_types_company_id_series_unique" UNIQUE("company_id","series")
);

CREATE TABLE "documents" (
    "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "company_id"       uuid NOT NULL,
    "document_type_id" smallint NOT NULL,
    "number"           varchar(50) NOT NULL,   -- 'SI-0007', from number_sequences
    "status"           "document_status" DEFAULT 'draft' NOT NULL,
    "document_date"    date NOT NULL,
    "contact_id"       uuid,
    "currency_id"      uuid,
    "exchange_rate"    numeric(18,6) DEFAULT '1' NOT NULL,
    "subtotal"         numeric(18,2) DEFAULT '0' NOT NULL,
    "discount_total"   numeric(18,2) DEFAULT '0' NOT NULL,
    "tax_total"        numeric(18,2) DEFAULT '0' NOT NULL,
    "shipping_total"   numeric(18,2) DEFAULT '0' NOT NULL,
    "grand_total"      numeric(18,2) DEFAULT '0' NOT NULL,
    -- Unpaid documents get a ledger_entries row (money owed). Paid ones record
    -- how they settled instead: exactly one of bank/cash here, or a
    -- cheque_register row pointing back at this document.
    "is_paid"          boolean DEFAULT false NOT NULL,
    "bank_account_id"  uuid,
    "cash_account_id"  uuid,
    "notes"            text,
    "created_by"       uuid,
    "approved_by"      uuid,
    "cancelled_by"     uuid,
    "created_at"       timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at"       timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "documents_company_id_document_type_id_number_unique" UNIQUE("company_id","document_type_id","number")
);

CREATE TABLE "document_lines" (
    "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "company_id"    uuid NOT NULL,
    "document_id"   uuid NOT NULL,
    "line_no"       integer NOT NULL,
    "item_id"       uuid,          -- NULL for free-text lines not in the catalogue
    "description"   text,
    "location_id"   uuid,
    "unit_id"       uuid,
    "quantity"      numeric(18,3) DEFAULT '0' NOT NULL,
    "base_quantity" numeric(18,3) DEFAULT '0' NOT NULL,  -- quantity × unit conversion
    "unit_price"    numeric(18,4) DEFAULT '0' NOT NULL,
    "unit_cost"     numeric(18,4),
    "line_total"    numeric(18,2) DEFAULT '0' NOT NULL,
    "sort_order"    integer DEFAULT 0 NOT NULL,
    CONSTRAINT "document_lines_document_id_line_no_unique" UNIQUE("document_id","line_no")
);
```

### Inventory and accounting effects

```sql
-- Stock on hand is SUM(movement × base_quantity) over these rows. movement is
-- +1 (in) or -1 (out). ON DELETE restrict on the line: you cannot delete a line
-- that has already moved stock without dealing with the movement first.
CREATE TABLE "inventory_transactions" (
    "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "company_id"       uuid NOT NULL,
    "document_line_id" uuid NOT NULL,
    "movement"         smallint NOT NULL,
    "quantity"         numeric(18,3) NOT NULL,
    "base_quantity"    numeric(18,3) NOT NULL,
    "unit_cost"        numeric(18,4),
    "total_cost"       numeric(18,2),
    "created_at"       timestamp with time zone DEFAULT now(),
    CONSTRAINT "inventory_transactions_movement_check"       CHECK ("inventory_transactions"."movement" IN (-1,1)),
    CONSTRAINT "inventory_transactions_quantity_check"       CHECK ("inventory_transactions"."quantity" >= 0),
    CONSTRAINT "inventory_transactions_base_quantity_check"  CHECK ("inventory_transactions"."base_quantity" >= 0)
);

-- Strictly one-sided: a row is either a debit or a credit, never both, never zero.
CREATE TABLE "ledger_entries" (
    "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "company_id"  uuid NOT NULL,
    "document_id" uuid NOT NULL,
    "debit"       numeric(18,2) DEFAULT '0',
    "credit"      numeric(18,2) DEFAULT '0',
    "created_at"  timestamp with time zone DEFAULT now(),
    CONSTRAINT "ledger_entries_debit_credit_check"
        CHECK (("ledger_entries"."debit" = 0 AND "ledger_entries"."credit" > 0)
            OR ("ledger_entries"."credit" = 0 AND "ledger_entries"."debit" > 0))
);
```

---

## 7. Numbering

Two tables, two jobs. `number_sequences` **allocates**;
`document_number_ledger` **records**.

```sql
-- Every sequential number in the system: item SKUs and document numbers alike.
--   scope 'sku'                        -> RH-00001, RH-00002, ...
--   scope 'doc:<companyId>:<typeId>'   -> SI-0001, SI-0002, ...
--
-- One statement allocates, so concurrent creates cannot collide:
--
--   INSERT INTO number_sequences AS s (scope, next_value) VALUES ($1, 2)
--   ON CONFLICT (scope) DO UPDATE SET next_value = s.next_value + 1
--   RETURNING next_value - 1;
--
-- This replaced COUNT(*) + 1, which is a read followed by a write and therefore
-- hands two simultaneous invoices the same number. Allocation runs inside the
-- caller's transaction, so a rolled-back create returns its number rather than
-- leaving a gap. See lib/db/sequences.ts and lib/db/sequences.check.ts.
CREATE TABLE "number_sequences" (
    "scope"      varchar(120) PRIMARY KEY NOT NULL,
    "next_value" integer DEFAULT 1 NOT NULL
);

-- Permanent record of every document number ever issued. Rows are never deleted,
-- even when the document is (document_id becomes NULL), so a deleted invoice's
-- number is never handed out a second time.
CREATE TABLE "document_number_ledger" (
    "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "company_id"       uuid NOT NULL,
    "document_type_id" smallint NOT NULL,
    "number"           varchar(50) NOT NULL,
    "document_id"      uuid,
    "created_at"       timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "document_number_ledger_company_id_document_type_id_number_unique" UNIQUE("company_id","document_type_id","number")
);
```

---

## 8. Banking and expenses

```sql
-- company_id NULL means the account is shared across companies.
CREATE TABLE "bank_accounts" (
    "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "company_id"      uuid,
    "bank_name"       varchar(150) NOT NULL,
    "branch_name"     varchar(150),
    "account_title"   varchar(200) NOT NULL,
    "account_number"  varchar(50) NOT NULL,
    "iban"            varchar(34),
    "swift_code"      varchar(20),
    "opening_balance" numeric(18,2) DEFAULT '0',
    "current_balance" numeric(18,2) DEFAULT '0',
    "is_default"      boolean DEFAULT false NOT NULL,
    "is_active"       boolean DEFAULT true NOT NULL,
    "created_at"      timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "bank_accounts_company_id_account_number_unique" UNIQUE("company_id","account_number")
);

CREATE TABLE "cash_accounts" (
    "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "company_id"      uuid NOT NULL,
    "name"            varchar(150) NOT NULL,
    "opening_balance" numeric(18,2) DEFAULT '0',
    "current_balance" numeric(18,2) DEFAULT '0',
    "is_default"      boolean DEFAULT false NOT NULL,
    "is_active"       boolean DEFAULT true NOT NULL,
    "created_at"      timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "cash_accounts_company_id_name_unique" UNIQUE("company_id","name")
);

-- A cheque settles at most one thing: a document (via document_id here) or an
-- expense (via expenses.cheque_id, which is UNIQUE). "Available cheques" means
-- linked to neither.
CREATE TABLE "cheque_register" (
    "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "company_id"        uuid NOT NULL,
    "bank_account_id"   uuid,
    "document_id"       uuid,
    "contact_id"        uuid,
    "cheque_number"     varchar(50) NOT NULL,
    "cheque_date"       date NOT NULL,
    "amount"            numeric(18,2) NOT NULL,
    "cheque_type"       "cheque_type" NOT NULL,
    "status"            "cheque_status" DEFAULT 'IN_HAND' NOT NULL,
    "issued_by_company" boolean DEFAULT false NOT NULL,
    "remarks"           text,
    "created_at"        timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "cheque_register_bank_account_id_cheque_number_unique" UNIQUE("bank_account_id","cheque_number"),
    CONSTRAINT "cheque_register_amount_check" CHECK ("cheque_register"."amount" > 0)
);

-- Deliberately not a document: no lines, no contact, no inventory effect.
CREATE TABLE "expenses" (
    "id"                  uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "company_id"          uuid NOT NULL,
    "expense_category_id" uuid NOT NULL,
    "location_id"         uuid,
    "bank_account_id"     uuid,
    "cash_account_id"     uuid,
    "cheque_id"           uuid,
    "amount"              numeric(18,2) NOT NULL,
    "expense_date"        date NOT NULL,
    "notes"               text,
    "attachment_url"      text,
    "created_by"          uuid,
    "created_at"          timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "expenses_cheque_id_unique" UNIQUE("cheque_id"),
    CONSTRAINT "expenses_amount_check" CHECK ("expenses"."amount" > 0)
);
```

---

## 9. Foreign keys, indexes and row-level security

Applied after all tables exist, so circular references are fine.

```sql
-- Tenancy: every scoped table points at companies.
ALTER TABLE "bank_accounts"          ADD CONSTRAINT "bank_accounts_company_id_companies_id_fk"          FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");
ALTER TABLE "cash_accounts"          ADD CONSTRAINT "cash_accounts_company_id_companies_id_fk"          FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");
ALTER TABLE "cheque_register"        ADD CONSTRAINT "cheque_register_company_id_companies_id_fk"        FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");
ALTER TABLE "contacts"               ADD CONSTRAINT "contacts_company_id_companies_id_fk"               FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");
ALTER TABLE "document_lines"         ADD CONSTRAINT "document_lines_company_id_companies_id_fk"         FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");
ALTER TABLE "document_number_ledger" ADD CONSTRAINT "document_number_ledger_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");
ALTER TABLE "document_types"         ADD CONSTRAINT "document_types_company_id_companies_id_fk"         FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");
ALTER TABLE "documents"              ADD CONSTRAINT "documents_company_id_companies_id_fk"              FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");
ALTER TABLE "expense_categories"     ADD CONSTRAINT "expense_categories_company_id_companies_id_fk"     FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");
ALTER TABLE "expenses"               ADD CONSTRAINT "expenses_company_id_companies_id_fk"               FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");
ALTER TABLE "item_images"            ADD CONSTRAINT "item_images_company_id_companies_id_fk"            FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");
ALTER TABLE "items"                  ADD CONSTRAINT "items_company_id_companies_id_fk"                  FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");
ALTER TABLE "ledger_entries"         ADD CONSTRAINT "ledger_entries_company_id_companies_id_fk"         FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");
ALTER TABLE "price_lists"            ADD CONSTRAINT "price_lists_company_id_companies_id_fk"            FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");
ALTER TABLE "settings"               ADD CONSTRAINT "settings_company_id_companies_id_fk"               FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");
ALTER TABLE "unit_conversions"       ADD CONSTRAINT "unit_conversions_company_id_companies_id_fk"       FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");

-- Catalogue.
ALTER TABLE "categories"       ADD CONSTRAINT "categories_parent_id_categories_id_fk"       FOREIGN KEY ("parent_id")    REFERENCES "public"."categories"("id");
ALTER TABLE "items"            ADD CONSTRAINT "items_category_id_categories_id_fk"          FOREIGN KEY ("category_id")  REFERENCES "public"."categories"("id");
ALTER TABLE "items"            ADD CONSTRAINT "items_brand_id_brands_id_fk"                 FOREIGN KEY ("brand_id")     REFERENCES "public"."brands"("id");
ALTER TABLE "item_images"      ADD CONSTRAINT "item_images_item_id_items_id_fk"             FOREIGN KEY ("item_id")      REFERENCES "public"."items"("id") ON DELETE cascade;
ALTER TABLE "unit_conversions" ADD CONSTRAINT "unit_conversions_item_id_items_id_fk"        FOREIGN KEY ("item_id")      REFERENCES "public"."items"("id");
ALTER TABLE "unit_conversions" ADD CONSTRAINT "unit_conversions_from_unit_id_units_id_fk"   FOREIGN KEY ("from_unit_id") REFERENCES "public"."units"("id");
ALTER TABLE "unit_conversions" ADD CONSTRAINT "unit_conversions_to_unit_id_units_id_fk"     FOREIGN KEY ("to_unit_id")   REFERENCES "public"."units"("id");

-- Documents. Lines cascade with their document; inventory restricts, so stock
-- that has already moved cannot be silently deleted.
ALTER TABLE "documents"              ADD CONSTRAINT "documents_document_type_id_document_types_id_fk"              FOREIGN KEY ("document_type_id") REFERENCES "public"."document_types"("id");
ALTER TABLE "documents"              ADD CONSTRAINT "documents_contact_id_contacts_id_fk"                          FOREIGN KEY ("contact_id")       REFERENCES "public"."contacts"("id");
ALTER TABLE "documents"              ADD CONSTRAINT "documents_currency_id_currencies_id_fk"                       FOREIGN KEY ("currency_id")      REFERENCES "public"."currencies"("id");
ALTER TABLE "documents"              ADD CONSTRAINT "documents_bank_account_id_bank_accounts_id_fk"                FOREIGN KEY ("bank_account_id")  REFERENCES "public"."bank_accounts"("id");
ALTER TABLE "documents"              ADD CONSTRAINT "documents_cash_account_id_cash_accounts_id_fk"                FOREIGN KEY ("cash_account_id")  REFERENCES "public"."cash_accounts"("id");
ALTER TABLE "document_lines"         ADD CONSTRAINT "document_lines_document_id_documents_id_fk"                   FOREIGN KEY ("document_id")      REFERENCES "public"."documents"("id") ON DELETE cascade;
ALTER TABLE "document_lines"         ADD CONSTRAINT "document_lines_item_id_items_id_fk"                           FOREIGN KEY ("item_id")          REFERENCES "public"."items"("id");
ALTER TABLE "document_lines"         ADD CONSTRAINT "document_lines_location_id_locations_id_fk"                   FOREIGN KEY ("location_id")      REFERENCES "public"."locations"("id");
ALTER TABLE "document_lines"         ADD CONSTRAINT "document_lines_unit_id_units_id_fk"                           FOREIGN KEY ("unit_id")          REFERENCES "public"."units"("id");
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_document_line_id_document_lines_id_fk" FOREIGN KEY ("document_line_id") REFERENCES "public"."document_lines"("id") ON DELETE restrict;
ALTER TABLE "ledger_entries"         ADD CONSTRAINT "ledger_entries_document_id_documents_id_fk"                   FOREIGN KEY ("document_id")      REFERENCES "public"."documents"("id");
ALTER TABLE "document_number_ledger" ADD CONSTRAINT "document_number_ledger_document_type_id_document_types_id_fk" FOREIGN KEY ("document_type_id") REFERENCES "public"."document_types"("id");
ALTER TABLE "document_number_ledger" ADD CONSTRAINT "document_number_ledger_document_id_documents_id_fk"           FOREIGN KEY ("document_id")      REFERENCES "public"."documents"("id") ON DELETE set null;

-- Banking and expenses.
ALTER TABLE "cheque_register" ADD CONSTRAINT "cheque_register_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id")     REFERENCES "public"."bank_accounts"("id");
ALTER TABLE "cheque_register" ADD CONSTRAINT "cheque_register_document_id_documents_id_fk"         FOREIGN KEY ("document_id")         REFERENCES "public"."documents"("id");
ALTER TABLE "cheque_register" ADD CONSTRAINT "cheque_register_contact_id_contacts_id_fk"           FOREIGN KEY ("contact_id")          REFERENCES "public"."contacts"("id");
ALTER TABLE "expenses"        ADD CONSTRAINT "expenses_expense_category_id_expense_categories_id_fk" FOREIGN KEY ("expense_category_id") REFERENCES "public"."expense_categories"("id");
ALTER TABLE "expenses"        ADD CONSTRAINT "expenses_location_id_locations_id_fk"                 FOREIGN KEY ("location_id")         REFERENCES "public"."locations"("id");
ALTER TABLE "expenses"        ADD CONSTRAINT "expenses_bank_account_id_bank_accounts_id_fk"         FOREIGN KEY ("bank_account_id")     REFERENCES "public"."bank_accounts"("id");
ALTER TABLE "expenses"        ADD CONSTRAINT "expenses_cash_account_id_cash_accounts_id_fk"         FOREIGN KEY ("cash_account_id")     REFERENCES "public"."cash_accounts"("id");
ALTER TABLE "expenses"        ADD CONSTRAINT "expenses_cheque_id_cheque_register_id_fk"             FOREIGN KEY ("cheque_id")           REFERENCES "public"."cheque_register"("id");

-- Access control. All cascade: removing a user or role removes its grants.
ALTER TABLE "role_permissions"      ADD CONSTRAINT "role_permissions_role_id_roles_id_fk"              FOREIGN KEY ("role_id")       REFERENCES "public"."roles"("id")       ON DELETE cascade;
ALTER TABLE "role_permissions"      ADD CONSTRAINT "role_permissions_permission_id_permissions_id_fk"  FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE cascade;
ALTER TABLE "user_roles"            ADD CONSTRAINT "user_roles_user_id_users_id_fk"                    FOREIGN KEY ("user_id")       REFERENCES "public"."users"("id")       ON DELETE cascade;
ALTER TABLE "user_roles"            ADD CONSTRAINT "user_roles_role_id_roles_id_fk"                    FOREIGN KEY ("role_id")       REFERENCES "public"."roles"("id")       ON DELETE cascade;
ALTER TABLE "user_roles"            ADD CONSTRAINT "user_roles_company_id_companies_id_fk"             FOREIGN KEY ("company_id")    REFERENCES "public"."companies"("id")   ON DELETE cascade;
ALTER TABLE "user_company_access"   ADD CONSTRAINT "user_company_access_user_id_users_id_fk"           FOREIGN KEY ("user_id")       REFERENCES "public"."users"("id")       ON DELETE cascade;
ALTER TABLE "user_company_access"   ADD CONSTRAINT "user_company_access_company_id_companies_id_fk"    FOREIGN KEY ("company_id")    REFERENCES "public"."companies"("id")   ON DELETE cascade;
ALTER TABLE "user_warehouse_access" ADD CONSTRAINT "user_warehouse_access_user_id_users_id_fk"         FOREIGN KEY ("user_id")       REFERENCES "public"."users"("id")       ON DELETE cascade;
ALTER TABLE "user_warehouse_access" ADD CONSTRAINT "user_warehouse_access_location_id_locations_id_fk" FOREIGN KEY ("location_id")   REFERENCES "public"."locations"("id")   ON DELETE cascade;
```

```sql
CREATE INDEX "idx_items_name"              ON "items"                  USING btree ("name");
CREATE INDEX "idx_items_sku"               ON "items"                  USING btree ("sku");
CREATE INDEX "idx_items_category"          ON "items"                  USING btree ("category_id");
CREATE INDEX "idx_items_brand"             ON "items"                  USING btree ("brand_id");
CREATE INDEX "idx_item_images_item"        ON "item_images"            USING btree ("item_id");
CREATE INDEX "idx_documents_date"          ON "documents"              USING btree ("document_date");
CREATE INDEX "idx_documents_contact"       ON "documents"              USING btree ("contact_id");
CREATE INDEX "idx_documents_status"        ON "documents"              USING btree ("status");
CREATE INDEX "idx_documents_type"          ON "documents"              USING btree ("document_type_id");
CREATE INDEX "idx_document_lines_document" ON "document_lines"         USING btree ("document_id");
CREATE INDEX "idx_document_lines_item"     ON "document_lines"         USING btree ("item_id");
CREATE INDEX "idx_document_lines_location" ON "document_lines"         USING btree ("location_id");
CREATE INDEX "idx_inventory_document_line" ON "inventory_transactions" USING btree ("document_line_id");
```

### Row-level security

Twenty-two tables enable RLS with a policy for the `app_user` role. The shape is
the same in each case — a row is visible if its company is one the current user
has access to:

```sql
ALTER TABLE "items" ENABLE ROW LEVEL SECURITY;   -- and the other 21

CREATE POLICY "company_scope" ON "items"
    AS PERMISSIVE FOR ALL TO "app_user"
    USING      (company_id IN (SELECT company_id FROM user_company_access
                               WHERE user_id = current_setting('app.user_id', true)::uuid))
    WITH CHECK (company_id IN (SELECT company_id FROM user_company_access
                               WHERE user_id = current_setting('app.user_id', true)::uuid));
```

Tables that vary:

- **`bank_accounts`, `contacts`, `currencies`, `categories`, `brands`, `unit_conversions`** — also allow `company_id IS NULL` (a global row every company can see; this is the default for these). `units` is unconditionally global — it has no `company_id` at all.
- **`locations`** — allows `company_id IS NULL`, the company check, **or** an explicit grant in `user_warehouse_access`.

No RLS on `companies`, `users`, `roles`, `permissions`, `role_permissions`,
`user_roles`, `user_company_access`, `user_warehouse_access`, `units` or
`number_sequences` — these are either global reference data or the very tables
the policies read to make their decision.

> **RLS is not active today.** The application connects as a `BYPASSRLS` role, so
> these policies never evaluate. Enforcement is done in the application layer by
> `requirePermission()` on every server action. See §10.

---

## 10. Views

### `rate_list`

Per item, the last three `PURCHASE_INVOICE` unit prices and their dates — a
rolling rate history for pricing decisions. Applied as a hand-written migration
(`drizzle/0007_create_rate_list_view.sql`) rather than a typed Drizzle view,
because the correlated `OFFSET`/`LIMIT` subqueries don't map onto the query
builder.

```sql
CREATE VIEW rate_list AS
SELECT
    i.id,
    i.sku,
    i.name,
    (SELECT dl.unit_price  FROM document_lines dl
       JOIN documents d       ON d.id  = dl.document_id
       JOIN document_types dt ON dt.id = d.document_type_id
      WHERE dl.item_id = i.id AND dt.code = 'PURCHASE_INVOICE'
      ORDER BY d.document_date DESC LIMIT 1)             AS purchase_rate_1,
    (SELECT d.document_date FROM document_lines dl
       JOIN documents d       ON d.id  = dl.document_id
       JOIN document_types dt ON dt.id = d.document_type_id
      WHERE dl.item_id = i.id AND dt.code = 'PURCHASE_INVOICE'
      ORDER BY d.document_date DESC LIMIT 1)             AS purchase_date_1,
    (SELECT dl.unit_price  FROM document_lines dl
       JOIN documents d       ON d.id  = dl.document_id
       JOIN document_types dt ON dt.id = d.document_type_id
      WHERE dl.item_id = i.id AND dt.code = 'PURCHASE_INVOICE'
      ORDER BY d.document_date DESC OFFSET 1 LIMIT 1)    AS purchase_rate_2,
    (SELECT d.document_date FROM document_lines dl
       JOIN documents d       ON d.id  = dl.document_id
       JOIN document_types dt ON dt.id = d.document_type_id
      WHERE dl.item_id = i.id AND dt.code = 'PURCHASE_INVOICE'
      ORDER BY d.document_date DESC OFFSET 1 LIMIT 1)    AS purchase_date_2,
    (SELECT dl.unit_price  FROM document_lines dl
       JOIN documents d       ON d.id  = dl.document_id
       JOIN document_types dt ON dt.id = d.document_type_id
      WHERE dl.item_id = i.id AND dt.code = 'PURCHASE_INVOICE'
      ORDER BY d.document_date DESC OFFSET 2 LIMIT 1)    AS purchase_rate_3,
    (SELECT d.document_date FROM document_lines dl
       JOIN documents d       ON d.id  = dl.document_id
       JOIN document_types dt ON dt.id = d.document_type_id
      WHERE dl.item_id = i.id AND dt.code = 'PURCHASE_INVOICE'
      ORDER BY d.document_date DESC OFFSET 2 LIMIT 1)    AS purchase_date_3
FROM items i;
```

Gotchas:

- Returns all-`NULL` rate columns until a `document_types` row with
  `code = 'PURCHASE_INVOICE'` exists for the company and purchases have been posted.
- Not `security_invoker` — it runs with the view owner's privileges, which have
  `BYPASSRLS`. Fine for direct `db` access; reconsider before exposing it to
  `app_user`, since it would ignore the policies in §9 rather than enforce them.

---

## 11. Known issues

Recorded rather than silently fixed, because each changes behaviour.

1. **`contacts.code` and `locations.code` are globally unique** for the same
   reason, so two companies cannot both use code `WH-01`. Lower impact — both
   columns are nullable and unused by the UI today.

2. **The `app_user` role has no grants.** `SET LOCAL ROLE app_user` fails with
   *permission denied*, so `withUserContext()` in `lib/db/context.ts` throws and
   has no callers. Every RLS policy in §9 is therefore inert. Authorisation is
   real, but it lives in `requirePermission()` in the application layer.

3. **`document_type_name` is a declared but unused enum.** `document_types.name`
   is `varchar(100)`.

4. **`payment_methods`** appeared in the original draft of this document and was
   never built. Settlement is modelled instead by `bank_accounts`,
   `cash_accounts` and `cheque_register`.
