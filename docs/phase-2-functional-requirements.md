# Royal Hardware ERP — Functional Requirements Specification (FRS)

**Phase:** 2 of 12
**Status:** Draft for approval
**Depends on:** [Phase 1 — Business Requirements Document](phase-1-business-requirements.md)

---

## Conventions

- Every requirement has an ID: `FR-<MODULE>-<NUM>` for traceability into DB design (Phase 3), API design (Phase 7), and testing (Phase 11).
- `[Company-scoped]` = the record belongs to exactly one company (Royal Hardware or M52).
- `[Shared]` = the record is common across companies.
- `[Soft-delete]` = record is never hard-deleted; deletion sets a `deleted_at`/`is_active` state and is written to the Audit Log.
- All monetary fields are PKR, stored as fixed-point (never float).

---

## 1. Dashboard

**Purpose:** Single-glance operational view for Admin (and a restricted view for Salesman).

| FR ID | Requirement |
|---|---|
| FR-DASH-001 | Dashboard shows: Today's Sales, Today's Profit, Today's Expenses, Inventory Value, Cash Position, Outstanding Receivables, Outstanding Payables, Low Stock count, Recent Sales, Recent Purchases, Top Products, Warehouse Summary. |
| FR-DASH-002 | A company filter (Royal Hardware / M52 / Both) and a warehouse filter must be available; "Both" aggregates but keeps profit/receivables/payables separable per company underneath. |
| FR-DASH-003 | Salesman's dashboard is restricted to Today's Sales (own), Recent Sales (own), and Low Stock — no profit, cash position, or payables/receivables (cost/margin data is Admin-only per FR-USER-010). |
| FR-DASH-004 | All dashboard figures are computed from underlying transactional tables at query time (or via a refreshed materialized view) — never stored as a manually-editable number. |

## 2. Inventory

### 2.1 Products `[Shared]`

| Field | Type/Notes |
|---|---|
| SKU | Unique, system-generated or manual override, immutable once transacted against |
| Product Name | Required |
| Urdu Name | Optional, for printed receipts/labels |
| Alias | Optional, used by Global Search |
| Brand | FK → Brands |
| Category / Sub-Category | FK → Categories / Sub-Categories (Sub-Category must belong to selected Category) |
| Description | Optional |
| Suppliers | Many-to-many; one may be marked "Preferred Supplier" |
| Pictures | 1..N, stored in Supabase Storage |
| Purchase Unit / Selling Unit | FK → Units; need not be the same unit (conversion applies, see 2.5) |
| Cost Price | Last purchase cost (informational) |
| Average Cost | System-calculated, see FR-PROD-006 |
| Selling Price | One or more price tiers (see FR-PROD-007) |
| GST | % rate, defaultable from Category, overridable per product |
| Barcode / QR Code | Reserved fields, not populated by UI in this phase (future) |
| Minimum Stock / Maximum Stock | Per warehouse (see FR-PROD-008) — used for Low Stock and reorder alerts |
| Status | Active / Inactive (inactive = hidden from new transactions, retained for history) |

| FR ID | Requirement |
|---|---|
| FR-PROD-001 | SKU is unique across the whole system (shared across companies), never reused even after soft-delete. |
| FR-PROD-002 | A product cannot be deleted (only deactivated) once it has any stock movement or transaction reference — enforced at the service layer, not just DB constraint. |
| FR-PROD-003 | Products are shared master data: both Royal Hardware and M52 sales/purchases reference the same Product record. |
| FR-PROD-004 | Sub-Category dropdown is dynamically filtered by the selected Category. |
| FR-PROD-005 | A product may have multiple suppliers; each supplier-product pair may carry its own last-purchase cost for comparison at PO time. |
| FR-PROD-006 | **Average Cost** is recalculated on every Purchase using the Weighted Average Cost method: `new_avg = ((old_qty * old_avg) + (received_qty * received_cost)) / (old_qty + received_qty)`, computed **per warehouse** (a product's average cost can legitimately differ by warehouse until stock is consolidated). *(Assumption — flagged in Open Items; confirm accounting method before Phase 3.)* |
| FR-PROD-007 | Selling Price supports at minimum one default price; architecture must allow future price tiers (e.g. Retail vs Wholesale) without schema redesign, even though only one tier is required now. |
| FR-PROD-008 | Minimum/Maximum Stock thresholds are defined **per warehouse per product**, not globally — a product can be "low stock" in Shop but fine in Warehouse. |
| FR-PROD-009 | GST defaults from the product's Category but is editable per product. |

### 2.2 Categories / Sub-Categories / Brands / Units `[Shared]`

| FR ID | Requirement |
|---|---|
| FR-CAT-001 | Category, Sub-Category, Brand, and Unit are simple shared lookup entities: name, optional description, status (active/inactive), soft-delete. |
| FR-CAT-002 | A Category/Sub-Category/Brand/Unit in use by any Product cannot be hard-deleted; deactivation only. |

### 2.3 Unit Conversions `[Shared]`

| FR ID | Requirement |
|---|---|
| FR-UNIT-001 | A Unit Conversion is a rule: `Base Unit → Target Unit, Factor` (e.g. 1 Sack = 20 Box). |
| FR-UNIT-002 | Conversions are transitive within a product's defined unit chain (Sack → Box → Pack → Piece); the system resolves any-to-any conversion within that chain by multiplying factors along the path, not by requiring every pair to be defined explicitly. |
| FR-UNIT-003 | Conversion factors are defined **per product** (two products may both use Box/Piece but with different factors), not globally per unit pair. |
| FR-UNIT-004 | Every stock movement, purchase line, and sale line records both the transacted Unit and the equivalent quantity in the product's Base (stocking) Unit, so stock-on-hand is always comparable across differing transaction units. |

### 2.4 Warehouses `[Shared]`

| FR ID | Requirement |
|---|---|
| FR-WH-001 | Unlimited warehouses; each has name, type/label (e.g. Warehouse, Shop, Transit), address, status. |
| FR-WH-002 | Stock-on-hand is always warehouse-scoped: `SUM(movements.quantity_in_base_unit)` grouped by product+warehouse. There is no "global stock" field to edit directly. |
| FR-WH-003 | A "Transit" warehouse (or equivalent flag on a warehouse) represents goods that have left the source but not yet been received at the destination during a Stock Transfer (see FR-XFER-002). |

### 2.5 Stock, Stock Transfers, Stock Adjustments, Stock Movement History

| FR ID | Requirement |
|---|---|
| FR-STK-001 | There is no direct "edit stock quantity" action anywhere in the system. Every change in stock is created by one of: Purchase, Sale, Transfer, Adjustment, Sales Return, Purchase Return, Damage, Correction. |
| FR-STK-002 | Every Stock Movement record captures: Product, Warehouse, Quantity, Unit (+ base-unit equivalent), Cost at time of movement, Reason, Reference Document (e.g. Invoice #, PO #), Date/Time, User. |
| FR-XFER-001 | A Stock Transfer moves stock from Warehouse A to Warehouse B and always creates **two linked movements**: an outbound movement from A and an inbound movement to B, sharing one Transfer reference number. |
| FR-XFER-002 | Transfer workflow states: `Initiated → In Transit → Received` (or `Rejected`). Stock leaves A's on-hand the moment it's Initiated; it does not appear in B's on-hand until marked Received. While In Transit it is visible in reporting as "in transit," not vanished. |
| FR-XFER-003 | A transfer can only be Received by a user with warehouse-B access (or Admin); partial receipt (received qty < sent qty) creates a variance that must be resolved via a Stock Adjustment with reason "Transfer Variance." |
| FR-ADJ-001 | A Stock Adjustment requires a mandatory Reason (from a controlled list: Damage, Expiry, Theft/Loss, Count Correction, Transfer Variance, Other) and, for "Other," a free-text note. |
| FR-ADJ-002 | Stock Adjustments above a configurable threshold quantity/value require Admin approval before posting (workflow: Draft → Pending Approval → Posted). Threshold is a Settings value. |
| FR-HIST-001 | Stock Movement History is a read-only, filterable (by product, warehouse, date range, reason, user) ledger view over all movements — it is a view, not a separate editable table. |

## 3. Purchases

### 3.1 Local Purchases / Import Purchases (M52) `[Company-scoped: Import Purchases are always company = M52]`

| FR ID | Requirement |
|---|---|
| FR-PUR-001 | A Purchase has: Supplier, Company (Local Purchases: Royal Hardware; Import Purchases: always M52), Warehouse (receiving), line items (Product, Qty, Unit, Cost), GST, totals, payment status (Unpaid/Partial/Paid), reference/invoice number from supplier. |
| FR-PUR-002 | Import Purchases additionally capture: shipment/BL reference, customs duty, freight, and other landed-cost components, which are allocated across line items to compute true landed cost feeding into Average Cost (FR-PROD-006). |
| FR-PUR-003 | Posting a Purchase (status: Draft → Posted) creates one Stock Movement per line (reason = Purchase) and updates Average Cost; a Draft purchase does not affect stock or ledger. |
| FR-PUR-004 | Posting a Purchase creates/updates a Supplier Ledger entry (debit business, i.e. increases what's owed to supplier) for the purchase total, and an Audit Log entry. |
| FR-PUR-005 | A Purchase Return reverses stock (reason = Purchase Return) and reduces the Supplier Ledger balance; it must reference the original Purchase. |

### 3.2 Suppliers `[Shared]`, Supplier Ledger `[Company-scoped]`

| FR ID | Requirement |
|---|---|
| FR-SUP-001 | Supplier profile: name, contact info, address, GST details, opening balance (per company — a supplier can have a separate opening balance/ledger under Royal Hardware vs M52), status. |
| FR-SUP-002 | Supplier Ledger = opening balance + all posted Purchases (debit) + all Payments made (credit), scoped per company, computed not manually entered. Running balance always derivable by replaying entries in date order. |
| FR-SUP-003 | Supplier's Purchase History and Import History are views filtered from the Purchases table by channel/type, not separate tables. |

## 4. Sales

### 4.1 Sales (unified) `[Company-scoped via Sales Channel]`

| FR ID | Requirement |
|---|---|
| FR-SALE-001 | One Sales table for all channels. `Sales Channel` enum: SHOP, WEB, M52, BALOCHISTAN (extensible list, stored as a lookup not a hardcoded enum, so a channel can be added via Settings without a migration). |
| FR-SALE-002 | Each Sales Channel maps to exactly one Company for ledger/GST purposes (e.g. M52 channel → M52 company; SHOP/WEB/BALOCHISTAN → Royal Hardware) — this mapping is configurable in Settings, not hardcoded, since the business may add channels later. |
| FR-SALE-003 | Posting a Sale creates one Stock Movement per line (reason = Sale, negative quantity) from the specified Warehouse, updates Customer Ledger, and writes an Audit Log entry. |
| FR-SALE-004 | A Sale cannot post for a quantity exceeding available stock at that warehouse **unless** an explicit "Allow Negative Stock" override (Admin-only, logged) is used — default is to block. |
| FR-SALE-005 | A Sales Return reverses stock (reason = Sales Return) and reduces the Customer Ledger balance; must reference the original Sale. |

### 4.2 Invoices

| FR ID | Requirement |
|---|---|
| FR-INV-001 | An Invoice is generated from a posted Sale (1:1) — it is the printable/PDF/WhatsApp representation of a Sale, not a separately maintained financial record. |
| FR-INV-002 | Invoice layout: business header (per company — Royal Hardware and M52 may have distinct letterheads/GST numbers), line items, GST breakdown, totals, payment status, terms. |
| FR-INV-003 | Invoice PDF generation and WhatsApp send are available from the same screen; sending does not alter invoice content. |

### 4.3 Quotations

| FR ID | Requirement |
|---|---|
| FR-QUO-001 | A Quotation has line items, prices, GST, validity date, status (Draft/Sent/Accepted/Expired/Converted). |
| FR-QUO-002 | Converting a Quotation to an Invoice creates a new Sale/Invoice referencing the Quotation; **partial conversion** (a subset of line items/quantities) is supported — the Quotation remains open for the unconverted remainder until manually closed or expired. |
| FR-QUO-003 | A Quotation does **not** affect stock or ledgers until converted — it is a non-transactional document. |

### 4.4 Customers `[Shared]`, Customer Ledger `[Company-scoped]`

| FR ID | Requirement |
|---|---|
| FR-CUST-001 | Customer profile: name, contact, WhatsApp number, address(es), GST details, opening balance (per company, same reasoning as FR-SUP-001), status. |
| FR-CUST-002 | Customer Ledger = opening balance + posted Sales (debit) + Payments received (credit) + Sales Returns (credit), scoped per company, computed from transactions. |
| FR-CUST-003 | Purchase History (customer's) is a view over Sales filtered by customer, not a separate table. |

## 5. Expenses

| FR ID | Requirement |
|---|---|
| FR-EXP-001 | Expense categories are a managed lookup list (Fuel, Transport, Tea, Electricity, Rent, Salary, Loading, Unloading, Import Duty, Petty Cash, + user-defined custom categories), not a hardcoded enum. |
| FR-EXP-002 | Each Expense: date, category, amount, company (which entity the expense belongs to), warehouse/location (optional), payment method, note, attachment (receipt photo, optional), created-by user. |
| FR-EXP-003 | Import Duty expenses can optionally link to an Import Purchase record for landed-cost traceability (feeds FR-PUR-002). |

## 6. WhatsApp

| FR ID | Requirement |
|---|---|
| FR-WA-001 | Integrates with the official Meta WhatsApp Cloud API using pre-approved message templates for: Invoice, Quotation, Ledger Statement, Outstanding Reminder, Payment Confirmation, Order Confirmation. |
| FR-WA-002 | Each send is logged (recipient, template used, document referenced, timestamp, delivery status from Meta's webhook) — this log is separate from but linked to the Audit Log. |
| FR-WA-003 | Sending requires the customer/supplier to have a valid WhatsApp-formatted phone number; the system validates format before allowing send. |
| FR-WA-004 | Template content/business info (company letterhead, GST number) reflects the **company** the document belongs to (Royal Hardware vs M52). |

## 7. Reports

| FR ID | Requirement |
|---|---|
| FR-RPT-001 | All reports (Daily/Monthly/Yearly Sales, Profit, Expenses, Inventory, Warehouse Stock, Customer/Supplier Ledger, Outstanding Receivables/Payables, Dead Stock, Fast/Slow Moving, Purchase, GST) support filtering by: date range, company, warehouse, and (where applicable) category/brand/customer/supplier. |
| FR-RPT-002 | Every report is exportable (CSV at minimum; PDF for customer/supplier-facing ones like Ledger and GST). |
| FR-RPT-003 | Profit reports use Average Cost (FR-PROD-006) at time of sale, not current average cost, so historical profit figures don't drift when costs change later — this requires storing cost-at-time-of-sale on the Sale line, not recomputing from current Product data. |
| FR-RPT-004 | Dead/Fast/Slow-moving classification is threshold-based and configurable in Settings (e.g. "no sales in 90 days" = dead stock), not hardcoded. |

## 8. Users, Roles, Permissions, Audit Logs

| FR ID | Requirement |
|---|---|
| FR-USER-001 | Users have: name, login (email/username), password (via Supabase Auth), status (active/inactive/locked), assigned Role(s), assigned Warehouse(s) and Company(ies) they may access. |
| FR-USER-002 | Roles are data-driven records; Permissions are granular per-module actions (View/Create/Edit/Delete/Approve/Export) assigned to Roles, not hardcoded per user. |
| FR-USER-003 | Default Roles seeded at setup: **Admin** (all permissions, all companies/warehouses) and **Salesman** (Create/View on Sales, Invoices, Quotations, Customers; View-only on Stock levels; explicitly denied: Cost Price, Average Cost, Profit figures, Purchases, Expenses, Supplier Ledger, Users/Roles, Settings). *(Default matrix — confirm/adjust in review.)* |
| FR-USER-010 | Cost/margin visibility is enforced at the API layer (not just hidden in UI) — a Salesman-scoped request must never receive cost fields in the response payload. |
| FR-AUDIT-001 | Every Create/Update/Delete on every business entity writes an Audit Log entry: user, table/record, old value (JSON), new value (JSON), timestamp, IP address, user agent, and reason (required for Deletes and for Adjustments per FR-ADJ-001; optional elsewhere). |
| FR-AUDIT-002 | Audit Logs are immutable and never themselves editable or deletable, even by Admin. |

## 9. Settings & Backups

| FR ID | Requirement |
|---|---|
| FR-SET-001 | Settings holds: Companies (Royal Hardware, M52, + future), Sales Channel→Company mapping, GST default rates per category, Adjustment approval threshold, Dead-stock threshold, Expense categories, WhatsApp template config. |
| FR-BAK-001 | Manual Backup (on-demand) and Automatic Daily Backup produce a CSV export set and a ZIP archive; both are optionally uploaded to Google Drive via OAuth-connected account. |
| FR-BAK-002 | Historical backups are retained per a configurable retention policy (e.g. keep daily for 30 days, weekly for 6 months) — exact policy to be confirmed with business before Phase 3. |

## 10. Global Search

| FR ID | Requirement |
|---|---|
| FR-SRCH-001 | A single search bar queries across Products, Customers, Suppliers, Invoices, Purchases, Sales, Quotations, Ledgers, Warehouses, returning grouped, permission-filtered results (a Salesman never sees Supplier/Purchase results). |

---

## Open Items Carried Into Phase 3 (Database Design)

1. **Average Cost method** (FR-PROD-006): confirm Weighted Average vs FIFO — assumed Weighted Average.
2. **GST treatment**: inclusive vs exclusive pricing, and actual rate(s) per category — not yet specified.
3. **Default Salesman permission matrix** (FR-USER-003): confirm the denied/allowed list before it's encoded as seed data.
4. **Adjustment approval threshold value** (FR-ADJ-002) and **Dead-stock threshold** (FR-RPT-004): need actual numbers from the business.
5. **Backup retention policy** (FR-BAK-002): need actual retention durations.

These do not block Phase 3 from starting (the schema can be built with these as configurable values), but they should be answered before seed data / go-live.

---

**Next Step:** On approval, proceed to **Phase 3 — Database Design**, translating each module's fields and rules above into normalized tables, keys, and indexes.
