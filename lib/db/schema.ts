import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  smallint,
  numeric,
  timestamp,
  date,
  unique,
  index,
  check,
  primaryKey,
  foreignKey,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// --- Enums (docs/db/Royal_Hardware_ERP_SQL.md) ---

export const locationTypeEnum = pgEnum("location_type", [
  "shop",
  "warehouse",
  "transit",
  "damaged",
  "reserved",
]);

export const documentStatusEnum = pgEnum("document_status", [
  "draft",
  "pending",
  "approved",
  "posted",
  "cancelled",
]);

export const userStatusEnum = pgEnum("user_status", ["active", "inactive", "locked"]);

// How a person wants this app to look. Per user rather than per company: two
// people share a shop counter and a company's settings, but not their eyesight
// or the light they're standing in.
export const themePreferenceEnum = pgEnum("theme_preference", ["light", "dark"]);

// Where a sale came from. Everything sold over the counter is the default and
// always will be the bulk of it; the other two are the channels that need to be
// told apart afterwards when the takings are reconciled.
export const saleTypeEnum = pgEnum("sale_type", ["counter", "balochistan", "shopify"]);

export const chequeTypeEnum = pgEnum("cheque_type", [
  "ACCOUNT_PAYEE",
  "BEARER",
  "CROSS",
  "OPEN",
  "POST_DATED",
]);

export const chequeStatusEnum = pgEnum("cheque_status", [
  "RECEIVED",
  "ISSUED",
  "IN_HAND",
  "DEPOSITED",
  "CLEARED",
  "RETURNED",
  "CANCELLED",
  "VOID",
]);

export const documentTypeCodeEnum = pgEnum("document_type_code", [
  "PURCHASE_INVOICE",
  "PURCHASE_RETURN",
  "PURCHASE_ORDER",
  "SALES_INVOICE",
  "SALES_RETURN",
  "SALES_ORDER",
  "QUOTATION",
  "STOCK_TRANSFER",
  "STOCK_ADJUSTMENT",
  "STOCK_OPENING",
  "PAYMENT_RECEIVED",
  "PAYMENT_MADE",
  "JOURNAL_ENTRY",
  "EXPENSE",
  "DELIVERY_NOTE",
  "GOODS_RECEIPT",
  "MARKET_PURCHASE",
  "CREDIT_NOTE",
  "DEBIT_NOTE",
]);

export const documentSeriesEnum = pgEnum("document_series", [
  "PI",
  "PR",
  "PO",
  "SI",
  "SR",
  "SO",
  "QT",
  "ST",
  "SA",
  "OS",
  "RC",
  "PM",
  "JE",
  "EX",
  "DN",
  "GR",
  "MP",
  "CN",
  "DB",
]);

// --- Identity & Companies ---

// Per docs/phase-8-authentication.md §1: Supabase Auth (email + password) is the
// identity provider — password lives in Supabase's own `auth.users`, never here.
// `supabaseAuthId` links this profile row to that identity. Roles/permissions are
// now data-driven (see roles/permissions/role_permissions/user_roles below),
// replacing the old free-text `role` column (phase-3 §8.6, now resolved).
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  supabaseAuthId: uuid("supabase_auth_id").notNull().unique(),
  name: varchar("name", { length: 100 }).notNull(),
  email: varchar("email", { length: 150 }).notNull().unique(),
  status: userStatusEnum("status").notNull().default("active"),
  // Retained from the removed WhatsApp assistant: the phone this person used to
  // message the ERP from, full international form with no punctuation
  // (923001234567). No application code reads or writes it any more, but the
  // column stays — the database is untouched, and existing rows are history.
  whatsappNumber: varchar("whatsapp_number", { length: 20 }).unique(),
  // --- Display preferences -------------------------------------------------
  // These two ride along on the users row rather than living in a preferences
  // table of their own: they are one value each, read on every single request,
  // and the session query already fetches this row. A second table would be a
  // second round trip to a database ~170ms away to learn a font size.
  //
  // NOT NULL with defaults, so a user who has never opened Settings still
  // renders — the app reads these before it reads anything else.
  uiTheme: themePreferenceEnum("ui_theme").notNull().default("light"),
  // Root font size as a percentage. Tailwind sizes everything in rem, so this
  // one number scales text, padding and icons together. Bounded by a check
  // constraint, not just by the buttons that set it: a hand-written UPDATE of
  // 10000 would otherwise render the app unusable with no way back to Settings.
  uiScale: smallint("ui_scale").notNull().default(100),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  check("ui_scale_range", sql`${table.uiScale} BETWEEN 75 AND 175`),
]);

export const roles = pgTable("roles", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 100 }).notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// Catalog of module+action pairs (FR-USER-002: View/Create/Edit/Delete/Approve/Export
// per module). This is a fixed code-defined catalog; only role -> permission
// assignment happens through the Settings -> Roles UI (Phase 6 / Phase 7 §1.10).
export const permissions = pgTable(
  "permissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    module: varchar("module", { length: 100 }).notNull(),
    action: varchar("action", { length: 50 }).notNull(),
  },
  (table) => [unique().on(table.module, table.action)],
);

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: uuid("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
    permissionId: uuid("permission_id").notNull().references(() => permissions.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.roleId, table.permissionId] })],
);

// A user may hold multiple roles (FR-USER-001: "assigned Role(s)"), and the
// *same* user can hold a different role per company (e.g. Admin in Royal
// Hardware, Salesman in M52) — companyId is nullable: NULL means the role
// applies globally (every company in user_company_access), a set value scopes
// it to just that company. A user's effective permissions in company X are the
// union of their NULL-company roles and their company=X roles (lib/auth/session.ts).
export const userRoles = pgTable(
  "user_roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    roleId: uuid("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
  },
  (table) => [unique().on(table.userId, table.roleId, table.companyId)],
);

// Backs requirePermission()'s companyId scope check — the database-side
// boundary is `company_id` scoping enforced in lib/auth/scope.ts, not RLS.
export const userCompanyAccess = pgTable(
  "user_company_access",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.userId, table.companyId] })],
);

// "Warehouse" here is a `locations` row (warehouses were unified into locations
// in phase-3 §0's design) — backs requirePermission()'s warehouseId scope check.
export const userWarehouseAccess = pgTable(
  "user_warehouse_access",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    locationId: uuid("location_id").notNull().references(() => locations.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.userId, table.locationId] })],
);

export const companies = pgTable("companies", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 200 }).notNull(),
  shortName: varchar("short_name", { length: 50 }),
  phone: varchar("phone", { length: 30 }),
  email: varchar("email", { length: 150 }),
  taxNumber: varchar("tax_number", { length: 100 }),
  address: text("address"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// --- Contacts & Shared Lookups ---

export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: varchar("code", { length: 30 }).unique(),
    // Nullable: a contact with no companyId is global (visible to every
    // company); set it to scope the contact to one company only — same
    // nullable-scope shape as `locations` above.
    companyId: uuid("company_id").references(() => companies.id),
    displayName: varchar("display_name", { length: 200 }).notNull(),
    companyName: varchar("company_name", { length: 200 }),
    phone: varchar("phone", { length: 30 }),
    email: varchar("email", { length: 150 }),
    address: text("address"),
    city: varchar("city", { length: 100 }),
    taxNumber: varchar("tax_number", { length: 100 }),
    creditLimit: numeric("credit_limit", { precision: 18, scale: 2 }).default("0"),
    isActive: boolean("is_active").default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    // The contacts list and every picker scope by company.
    index("idx_contacts_company").on(table.companyId),
  ],
);

// Global — categories are shared across companies. slug unique on its own.
export const categories = pgTable("categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  parentId: uuid("parent_id").references((): AnyPgColumn => categories.id),
  name: varchar("name", { length: 150 }).notNull(),
  slug: varchar("slug", { length: 150 }).unique(),
  // Sibling order within a parent — set by the drag-and-drop category tree.
  sortOrder: integer("sort_order").notNull().default(0),
});

// Global — a brand is a brand everywhere. name unique on its own.
export const brands = pgTable("brands", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 150 }).notNull().unique(),
});

export const units = pgTable("units", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 50 }).notNull(),
  // Nullable: a unit typed on the fly (sale/purchase line) is created name-only;
  // a missing symbol is what marks the unit "incomplete" in the units list.
  symbol: varchar("symbol", { length: 20 }),
});

// Global — locations (shops/warehouses) are shared. Per-user access is still
// modelled by user_warehouse_access, which references locations.id.
export const locations = pgTable("locations", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 30 }).unique(),
  name: varchar("name", { length: 150 }).notNull(),
  locationType: locationTypeEnum("location_type").notNull(),
});

// Global — a tax rate is defined once and used everywhere.
export const taxes = pgTable("taxes", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 100 }).notNull(),
  rate: numeric("rate", { precision: 8, scale: 4 }).notNull().default("0"),
  isActive: boolean("is_active").notNull().default(true),
});

export const expenseCategories = pgTable(
  "expense_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    name: varchar("name", { length: 100 }).notNull(),
  },
  (table) => [
    unique().on(table.companyId, table.name),
  ],  );

export const expenses = pgTable(
  "expenses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    expenseCategoryId: uuid("expense_category_id").notNull().references(() => expenseCategories.id),
    // Settlement — exactly one set, same as documents.bank_account_id/cash_account_id.
    // Expenses aren't part of the documents universal model, so the cheque link
    // is a direct FK here instead of cheque_register.document_id.
    bankAccountId: uuid("bank_account_id").references(() => bankAccounts.id),
    cashAccountId: uuid("cash_account_id").references(() => cashAccounts.id),
    chequeId: uuid("cheque_id").references(() => chequeRegister.id),
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
    expenseDate: date("expense_date").notNull(),
    // The purchase this expense was created from, when it was a stock purchase's
    // shipping charge (paid from the default cash account and recorded here).
    // Null for expenses entered directly. Links the expense to the purchase so
    // editing or deleting the purchase reverses and re-writes it in the same
    // transaction — without it, an edited shipping charge would leave two
    // expenses for one delivery.
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "cascade" }),
    notes: text("notes"),
    attachmentUrl: text("attachment_url"),
    status: documentStatusEnum("status").notNull().default("posted"),
    cancelledBy: uuid("cancelled_by"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("expenses_amount_check", sql`${table.amount} > 0`),
    unique().on(table.chequeId),
    // The expenses list scopes by company; the stock-purchase edit reads an
    // expense back by the document it was created from.
    index("idx_expenses_company").on(table.companyId),
    index("idx_expenses_document").on(table.documentId),
  ],  );

// --- Items & Locations ---

export const items = pgTable(
  "items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    sku: varchar("sku", { length: 100 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    urduName: varchar("urdu_name", { length: 255 }),
    categoryId: uuid("category_id").references(() => categories.id),
    brandId: uuid("brand_id").references(() => brands.id),
    // Stock is always held in this unit. A transaction entered in another unit
    // is converted through unit_conversions before it reaches the inventory
    // ledger. Nullable only for legacy/new incomplete products; the first
    // transaction with a unit establishes it atomically.
    baseUnitId: uuid("base_unit_id").references(() => units.id),
    taxable: boolean("taxable").default(false),
    isActive: boolean("is_active").default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    // Per company, not global. The catalogs are separate rows (company_id is NOT
    // NULL and stock hangs off the row), but one physical product sold from Royal
    // to M52 is the same product — an inter-company sale copies the seller's SKU
    // to the buyer's row rather than minting a second one, which a global UNIQUE
    // made impossible.
    unique().on(table.companyId, table.sku),
    index("idx_items_name").on(table.name),
    index("idx_items_sku").on(table.sku),
    index("idx_items_category").on(table.categoryId),
    index("idx_items_brand").on(table.brandId),
  ],  );

// item_id FK added via ALTER TABLE in the source SQL (items didn't exist yet
// when unit_conversions was first declared) — expressed directly here since
// Drizzle table order doesn't need the split.
export const unitConversions = pgTable(
  "unit_conversions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").references(() => companies.id),
    itemId: uuid("item_id").notNull().references(() => items.id),
    fromUnitId: uuid("from_unit_id").notNull().references(() => units.id),
    toUnitId: uuid("to_unit_id").notNull().references(() => units.id),
    multiplier: numeric("multiplier", { precision: 18, scale: 6 }).notNull(),
  },
  (table) => [
    unique().on(table.itemId, table.fromUnitId, table.toUnitId),
    check("unit_conversions_multiplier_check", sql`${table.multiplier} > 0`),
  ],
);

export const itemImages = pgTable(
  "item_images",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    itemId: uuid("item_id").notNull().references(() => items.id, { onDelete: "cascade" }),
    imageUrl: text("image_url").notNull(),
    isPrimary: boolean("is_primary").default(false),
    sortOrder: integer("sort_order").default(0),
  },
  (table) => [
    index("idx_item_images_item").on(table.itemId),
  ],  );

// --- Documents — the Universal Transaction Model ---

// SMALLSERIAL in the source SQL; expressed as a smallint identity column here —
// drizzle-kit's native-types allowlist omits "smallserial" (has serial/bigserial
// only) and mis-renders it as a quoted custom type, producing invalid DDL.
export const documentTypes = pgTable(
  "document_types",
  {
    id: smallint("id").primaryKey().generatedAlwaysAsIdentity(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    code: documentTypeCodeEnum("code").notNull(),
    name: varchar("name", { length: 100 }).notNull(),
    series: documentSeriesEnum("series").notNull(),
    affectsInventory: boolean("affects_inventory").notNull().default(false),
    affectsAccounting: boolean("affects_accounting").notNull().default(false),
    affectsReceivable: boolean("affects_receivable").notNull().default(false),
    affectsPayable: boolean("affects_payable").notNull().default(false),
    positiveStock: boolean("positive_stock"),
    active: boolean("active").notNull().default(true),
  },
  (table) => [
    unique().on(table.companyId, table.code),
    // Scoped by company, not global. `series` used to be UNIQUE on its own,
    // which meant only one company in the entire database could own 'SI' —
    // ensureDocumentType() creates these per company, so the first sale in the
    // second company (M52) failed on that constraint. Each company gets its own
    // SI-0001 series now, matching the company+code rule above.
    unique().on(table.companyId, table.series),
    // Supports the composite documents FK below: a document type is not merely
    // an id, it belongs to the same company as the document using it.
    unique().on(table.companyId, table.id),
  ],  );

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    documentTypeId: smallint("document_type_id").notNull().references(() => documentTypes.id),
    number: varchar("number", { length: 50 }).notNull(),
    status: documentStatusEnum("status").notNull().default("draft"),
    documentDate: date("document_date").notNull(),
    contactId: uuid("contact_id").references(() => contacts.id),
    subtotal: numeric("subtotal", { precision: 18, scale: 2 }).notNull().default("0"),
    discountTotal: numeric("discount_total", { precision: 18, scale: 2 }).notNull().default("0"),
    taxTotal: numeric("tax_total", { precision: 18, scale: 2 }).notNull().default("0"),
    // The chosen tax rule and its immutable snapshot. Keeping the rate and
    // inclusive flag on the document means editing the Tax master or company
    // defaults never rewrites an old invoice.
    taxId: uuid("tax_id").references(() => taxes.id, { onDelete: "set null" }),
    taxRate: numeric("tax_rate", { precision: 8, scale: 4 }).notNull().default("0"),
    taxInclusive: boolean("tax_inclusive").notNull().default(false),
    shippingTotal: numeric("shipping_total", { precision: 18, scale: 2 }).notNull().default("0"),
    grandTotal: numeric("grand_total", { precision: 18, scale: 2 }).notNull().default("0"),
    // Unpaid documents get a matching ledger_entries credit row (money owed);
    // paid ones record how instead of touching the ledger.
    //
    // isPaid is the derived shorthand for paidAmount >= grandTotal. paidAmount is
    // the amount actually settled, which is what makes part payment expressible —
    // a sale can be 2000 in against a 3500 total, and grandTotal - paidAmount is
    // the balance still owed.
    isPaid: boolean("is_paid").notNull().default(false),
    paidAmount: numeric("paid_amount", { precision: 18, scale: 2 }).notNull().default("0"),
    // Settlement — exactly one set (or a cheque_register row linked via
    // cheque_register.document_id) per payment/paid-purchase document.
    bankAccountId: uuid("bank_account_id").references(() => bankAccounts.id),
    cashAccountId: uuid("cash_account_id").references(() => cashAccounts.id),
    // Why the document exists, when that isn't implied by its type — stock
    // adjustments require one (Damage, Count Correction, …); everything else
    // leaves it NULL.
    reason: varchar("reason", { length: 100 }),
    // Which channel a sale came through. Nullable and NULL on every other
    // document type, the same way `reason` belongs only to adjustments — a
    // purchase invoice has no sale type. Sales always carry one; it defaults to
    // counter rather than being asked twice for the common case.
    saleType: saleTypeEnum("sale_type"),
    // Quotations only: the date the quoted prices stop being honoured. NULL on
    // every other document type, the same way `reason` belongs only to
    // adjustments and `saleType` only to sales.
    validUntil: date("valid_until"),
    // Where this document came from, when it came from another one — an invoice
    // raised off a quotation points at the quotation. Nullable and self
    // referencing; ON DELETE SET NULL so deleting the quotation doesn't take the
    // invoice raised from it with it.
    sourceDocumentId: uuid("source_document_id").references((): AnyPgColumn => documents.id, { onDelete: "set null" }),
    createdBy: uuid("created_by"),
    approvedBy: uuid("approved_by"),
    cancelledBy: uuid("cancelled_by"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.companyId, table.documentTypeId],
      foreignColumns: [documentTypes.companyId, documentTypes.id],
      name: "documents_company_document_type_fk",
    }),
    unique().on(table.companyId, table.documentTypeId, table.number),
    index("idx_documents_date").on(table.documentDate),
    index("idx_documents_contact").on(table.contactId),
    index("idx_documents_status").on(table.status),
    index("idx_documents_type").on(table.documentTypeId),
  ],  );

// Issues every sequential number in the app — item SKUs (RH-00042) and document
// numbers (SI-0007) alike — one row per counter, keyed by an opaque scope
// string: 'sku', or 'doc:<series>' (one run per series, shared by every company —
// see lib/db/sequences.ts documentScope).
//
// Its whole reason to exist is atomicity. Numbers used to be derived by counting
// rows (COUNT(*) + 1), which reads a value, then writes one based on it — two
// concurrent creates read the same count and produce the same invoice number.
// A single INSERT .. ON CONFLICT DO UPDATE .. RETURNING increments and returns
// in one statement, so the database serialises it and no two callers can be
// handed the same number. See lib/db/sequences.ts.
//
// This allocates; it does not record. document_number_ledger below is still the
// log of which numbers were actually issued to which document.
export const numberSequences = pgTable("number_sequences", {
  scope: varchar("scope", { length: 120 }).primaryKey(),
  nextValue: integer("next_value").notNull().default(1),
});

// Tombstone log of every document number ever issued — rows here are never
// deleted, even when the document itself is, so a deleted document's number is
// never handed out again.
export const documentNumberLedger = pgTable(
  "document_number_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    documentTypeId: smallint("document_type_id").notNull().references(() => documentTypes.id),
    number: varchar("number", { length: 50 }).notNull(),
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique().on(table.companyId, table.documentTypeId, table.number),
  ],  );

export const documentLines = pgTable(
  "document_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    documentId: uuid("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    lineNo: integer("line_no").notNull(),
    itemId: uuid("item_id").references(() => items.id),
    locationId: uuid("location_id").references(() => locations.id),
    unitId: uuid("unit_id").references(() => units.id),
    quantity: numeric("quantity", { precision: 18, scale: 3 }).notNull().default("0"),
    baseQuantity: numeric("base_quantity", { precision: 18, scale: 3 }).notNull().default("0"),
    unitPrice: numeric("unit_price", { precision: 18, scale: 4 }).notNull().default("0"),
    unitCost: numeric("unit_cost", { precision: 18, scale: 4 }),
    lineTotal: numeric("line_total", { precision: 18, scale: 2 }).notNull().default("0"),
    // Taxability and tax amount are snapshots. Product taxability and a rate
    // may change later; an issued invoice must continue to add up exactly as it
    // did when it was posted.
    taxable: boolean("taxable").notNull().default(false),
    taxAmount: numeric("tax_amount", { precision: 18, scale: 2 }).notNull().default("0"),
    // Used by approval-gated stock adjustments. Pending adjustments have no
    // inventory_transaction yet, so the intended sign has to live on the line.
    stockMovement: smallint("stock_movement"),
    // A sale line can be fulfilled by buying the item specifically from the
    // market. It still posts the outbound sale immediately; confirmation of the
    // linked request posts the matching inbound movement and the actual cost.
    marketPurchase: boolean("market_purchase").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    // Quotation lines only: how much of this line has already been turned into
    // an invoice. A quotation is converted in parts — half the tiles now, the
    // rest when the second floor is ready — so "converted" is a quantity, not a
    // flag. NULL everywhere else.
    convertedQuantity: numeric("converted_quantity", { precision: 18, scale: 3 }),
  },
  (table) => [
    unique().on(table.documentId, table.lineNo),
    index("idx_document_lines_document").on(table.documentId),
    index("idx_document_lines_item").on(table.itemId),
    index("idx_document_lines_location").on(table.locationId),
    check("document_lines_stock_movement_check", sql`${table.stockMovement} IS NULL OR ${table.stockMovement} IN (-1, 1)`),
  ],  );

// A standalone receipt/payment settles the oldest open invoices for its contact
// and company. The payment and invoice documents remain independently auditable;
// this bridge records exactly how much of one paid the other. Amounts are never
// inferred from row order after posting.
export const paymentAllocations = pgTable(
  "payment_allocations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    paymentDocumentId: uuid("payment_document_id").notNull().references(() => documents.id, { onDelete: "restrict" }),
    invoiceDocumentId: uuid("invoice_document_id").notNull().references(() => documents.id, { onDelete: "restrict" }),
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique().on(table.paymentDocumentId, table.invoiceDocumentId),
    index("idx_payment_allocations_payment").on(table.paymentDocumentId),
    index("idx_payment_allocations_invoice").on(table.invoiceDocumentId),
    index("idx_payment_allocations_company").on(table.companyId),
    check("payment_allocations_amount_check", sql`${table.amount} > 0`),
  ],
);

export const marketPurchaseStatusEnum = pgEnum("market_purchase_status", ["pending", "confirmed", "cancelled"]);

export const marketPurchaseRequests = pgTable(
  "market_purchase_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    saleDocumentId: uuid("sale_document_id").notNull().references(() => documents.id, { onDelete: "restrict" }),
    saleLineId: uuid("sale_line_id").notNull().references(() => documentLines.id, { onDelete: "restrict" }),
    itemId: uuid("item_id").notNull().references(() => items.id),
    unitId: uuid("unit_id").references(() => units.id),
    quantity: numeric("quantity", { precision: 18, scale: 3 }).notNull(),
    baseQuantity: numeric("base_quantity", { precision: 18, scale: 3 }).notNull(),
    status: marketPurchaseStatusEnum("status").notNull().default("pending"),
    confirmationDocumentId: uuid("confirmation_document_id").references(() => documents.id, { onDelete: "restrict" }),
    expenseId: uuid("expense_id").references(() => expenses.id, { onDelete: "restrict" }),
    purchaseCost: numeric("purchase_cost", { precision: 18, scale: 4 }),
    confirmedBy: uuid("confirmed_by"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique().on(table.saleLineId),
    index("idx_market_purchase_status_company").on(table.status, table.companyId),
    index("idx_market_purchase_confirmation").on(table.confirmationDocumentId),
    check("market_purchase_quantity_check", sql`${table.quantity} > 0 AND ${table.baseQuantity} > 0`),
    check("market_purchase_cost_check", sql`${table.purchaseCost} IS NULL OR ${table.purchaseCost} >= 0`),
  ],
);

// --- Inventory Ledger ---

export const inventoryTransactions = pgTable(
  "inventory_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    documentLineId: uuid("document_line_id").notNull().references(() => documentLines.id, { onDelete: "restrict" }),
    movement: smallint("movement").notNull(),
    quantity: numeric("quantity", { precision: 18, scale: 3 }).notNull(),
    baseQuantity: numeric("base_quantity", { precision: 18, scale: 3 }).notNull(),
    unitCost: numeric("unit_cost", { precision: 18, scale: 4 }),
    totalCost: numeric("total_cost", { precision: 18, scale: 2 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("idx_inventory_document_line").on(table.documentLineId),
    // Every stock figure — dashboard valuation, the stock report, exports — is
    // scoped by company, and inventory_transactions is the fastest-growing
    // table in the schema (one row per document line per posting).
    index("idx_inventory_company").on(table.companyId),
    check("inventory_transactions_movement_check", sql`${table.movement} IN (-1, 1)`),
    check("inventory_transactions_quantity_check", sql`${table.quantity} >= 0`),
    check("inventory_transactions_base_quantity_check", sql`${table.baseQuantity} >= 0`),
  ],  );

// --- Accounting ---

export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    documentId: uuid("document_id").notNull().references(() => documents.id),
    debit: numeric("debit", { precision: 18, scale: 2 }).default("0"),
    credit: numeric("credit", { precision: 18, scale: 2 }).default("0"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    // Payments and purchases drop and re-read a document's entries on every
    // edit and delete, and the receivables/payables reports scan by company.
    index("idx_ledger_document").on(table.documentId),
    index("idx_ledger_company").on(table.companyId),
    check(
      "ledger_entries_debit_credit_check",
      sql`(${table.debit} = 0 AND ${table.credit} > 0) OR (${table.credit} = 0 AND ${table.debit} > 0)`,
    ),
  ],  );

// --- Settings ---

export const settings = pgTable(
  "settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    key: varchar("key", { length: 100 }).notNull(),
    value: text("value"),
  },
  (table) => [
    unique().on(table.companyId, table.key),
  ],  );


// --- WhatsApp ---

// Retained from the removed WhatsApp feature (the app no longer sends or
// receives messages — the tab in the sidebar is a placeholder). The table and
// its enum stay exactly as the database has them: rows here are history, and no
// application code reads or writes them any more.
export const whatsappStatusEnum = pgEnum("whatsapp_status", ["queued", "sent", "delivered", "read", "failed", "handoff"]);

export const whatsappMessages = pgTable(
  "whatsapp_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    // Who it went to. The number is copied alongside the contact because a
    // contact's number changes, and the log has to say where it actually went.
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    recipientName: varchar("recipient_name", { length: 200 }).notNull(),
    phone: varchar("phone", { length: 30 }).notNull(),
    // Which of the former lib/whatsapp-templates.ts produced the text.
    template: varchar("template", { length: 50 }).notNull(),
    // The document it was about, when it was about one (an invoice, a quotation).
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "set null" }),
    // The message as sent.
    body: text("body").notNull(),
    status: whatsappStatusEnum("status").notNull().default("queued"),
    // The provider's own id, which is what a delivery webhook arrived keyed by.
    providerMessageId: varchar("provider_message_id", { length: 120 }),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_whatsapp_created").on(table.createdAt),
    index("idx_whatsapp_provider_id").on(table.providerMessageId),
  ],  );

// --- Duplicate-submission protection ---

// One row per save attempt, keyed by an id the client form generates once per
// open form. The row is claimed inside the same transaction that writes the
// record it guards, so a retry of an already-committed save finds the key
// already taken and is refused instead of posting the document twice; a retry
// after a *failed* save finds nothing (the transaction rolled the claim back
// with the rest) and goes ahead. Old keys are pruned by the claiming statement
// itself, so the table never grows past a day of saves (lib/actions/
// operation-id.ts).
export const submittedOperations = pgTable("submitted_operations", {
  key: varchar("key", { length: 64 }).primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// --- Audit trail ---

// Who changed what, when, and why. Deliberately not a copy of the row before and
// after: a full before/after diff of every document line would outgrow the
// tables it describes, and nobody has ever answered a question with one. What
// gets asked in a shop is "who deleted that invoice" and "why was this stock
// adjusted", which is what these columns hold.
//
// Written by lib/actions/audit.ts, from the actions that mutate. A failure to
// write an audit row never fails the operation it describes — an unrecorded
// change is bad, a lost sale is worse.
export const auditAction = pgEnum("audit_action", ["create", "update", "delete", "cancel", "approve", "merge", "import"]);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Nullable: global reference data (a brand, a unit) belongs to no company.
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
    // Nullable and ON DELETE SET NULL, because the log has to outlive the
    // account that wrote it — that is the entire point of an audit trail. The
    // name is copied in beside it for the same reason.
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    userName: varchar("user_name", { length: 100 }).notNull(),
    action: auditAction("action").notNull(),
    // What kind of thing changed ("sale", "product"), and which one. entityId is
    // not a foreign key on purpose: the row it names is usually gone by the time
    // anyone reads a delete entry.
    entity: varchar("entity", { length: 50 }).notNull(),
    entityId: uuid("entity_id"),
    // How the record identifies itself to a human — "SI-0042", "OPC Cement 50kg".
    // Copied rather than joined, so a deleted record still reads as itself.
    summary: varchar("summary", { length: 200 }).notNull(),
    // Free text the user gave (a stock adjustment's reason), or a note the
    // action wrote about what it did ("merged 3 products into RH-00042").
    detail: text("detail"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The two ways this table is ever read: newest first, and everything that
    // touched one record.
    index("idx_audit_created").on(table.createdAt),
    index("idx_audit_entity").on(table.entity, table.entityId),
    // The audit screen also filters by who and under which company.
    index("idx_audit_user").on(table.userId),
    index("idx_audit_company").on(table.companyId),
  ],
);

// --- Banking ---

export const bankAccounts = pgTable(
  "bank_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Nullable: a bank account with no companyId is global (visible to every
    // company) — same nullable-scope shape as `contacts`/`locations` above.
    companyId: uuid("company_id").references(() => companies.id),
    bankName: varchar("bank_name", { length: 150 }).notNull(),
    branchName: varchar("branch_name", { length: 150 }),
    accountTitle: varchar("account_title", { length: 200 }).notNull(),
    accountNumber: varchar("account_number", { length: 50 }).notNull(),
    iban: varchar("iban", { length: 34 }),
    openingBalance: numeric("opening_balance", { precision: 18, scale: 2 }).default("0"),
    currentBalance: numeric("current_balance", { precision: 18, scale: 2 }).default("0"),
    isDefault: boolean("is_default").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique().on(table.companyId, table.accountNumber),
  ],
);

export const cashAccounts = pgTable(
  "cash_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    name: varchar("name", { length: 150 }).notNull(),
    openingBalance: numeric("opening_balance", { precision: 18, scale: 2 }).default("0"),
    currentBalance: numeric("current_balance", { precision: 18, scale: 2 }).default("0"),
    isDefault: boolean("is_default").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique().on(table.companyId, table.name),
  ],  );

export const chequeRegister = pgTable(
  "cheque_register",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    bankAccountId: uuid("bank_account_id").references(() => bankAccounts.id),
    documentId: uuid("document_id").references(() => documents.id),
    contactId: uuid("contact_id").references(() => contacts.id),
    chequeNumber: varchar("cheque_number", { length: 50 }).notNull(),
    chequeDate: date("cheque_date").notNull(),
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
    chequeType: chequeTypeEnum("cheque_type").notNull(),
    status: chequeStatusEnum("status").notNull().default("IN_HAND"),
    issuedByCompany: boolean("issued_by_company").notNull().default(false),
    remarks: text("remarks"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique().on(table.bankAccountId, table.chequeNumber),
    check("cheque_register_amount_check", sql`${table.amount} > 0`),
    // Payments link and settle a cheque by its document.
    index("idx_cheque_document").on(table.documentId),
  ],  );
