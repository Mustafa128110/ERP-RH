# Royal Hardware ERP — Business Requirements Document (BRD)

**Phase:** 1 of 12
**Status:** Draft for approval
**Owner:** Royal Hardware
**Prepared by:** Engineering (per ENGINEERING_CONSTITUTION.md)

---

## 1. Executive Summary

Royal Hardware currently runs on desktop inventory/accounting software. This document defines the business requirements for **Royal Hardware ERP**, a cloud-based system that will fully replace the desktop software while adding multi-warehouse, multi-company, WhatsApp, and reporting capabilities that the desktop system cannot provide.

This BRD describes *what the business needs*, not *how it will be built*. Technical architecture, database design, and API design are addressed in later phases.

---

## 2. Business Context

- **Business:** Royal Hardware — a hardware retail/wholesale business operating in Pakistan.
- **Currency:** PKR.
- **Tax:** GST, applied at the product/invoice level.
- **Branches:** Single physical branch, but with multiple **warehouses** (e.g. Warehouse, Shop, Transit) under that branch.
- **Companies:** The business operates as **two related but separate entities**:
  - **Royal Hardware** — the core retail/wholesale trading company.
  - **M52** — the company/account under which **all import purchases** are made, and through which imported stock is sold (Sales Channel = M52).
  - These two entities are **separate for financial/ledger purposes** (separate purchases, sales, ledgers, and GST reporting per company) but **share master data** — products, categories, brands, units, warehouses, customers, and suppliers are common across both companies rather than duplicated.
  - The system must be designed so **additional companies can be added later** without schema redesign (e.g. a third entity in the future).

## 3. Business Objectives

1. Fully replace the existing desktop inventory/accounting software — no functional regressions.
2. Provide real-time, traceable inventory across multiple warehouses.
3. Separate financial tracking for Royal Hardware vs. M52 (import) while avoiding duplicate product/customer/supplier records.
4. Give management real-time visibility into sales, profit, expenses, and outstanding balances via a dashboard.
5. Digitize customer/supplier ledgers, replacing manual/desktop ledger tracking.
6. Enable WhatsApp-based delivery of invoices, quotations, ledgers, and payment reminders using the **official Meta WhatsApp Cloud API** (business-verified, template-based, ToS-compliant — chosen over unofficial libraries specifically to avoid the risk of a business number being banned).
7. Provide audit-proof records: nothing is ever hard-deleted; every change is logged with who/what/when/why.
8. Support role-based access so an Admin and Salesman (and future roles) each see only what they should.

## 4. In-Scope Modules

| Domain | Modules |
|---|---|
| Core | Dashboard, Global Search, Settings, Backups |
| Inventory | Products, Categories, Sub-Categories, Brands, Units, Unit Conversions, Warehouses, Stock, Stock Transfers, Stock Adjustments, Stock Movement History |
| Procurement | Local Purchases, Import Purchases (M52), Suppliers, Supplier Ledger |
| Sales | Sales (unified, channel-based: SHOP / WEB / M52 / BALOCHISTAN), Invoices, Quotations, Customers, Customer Ledger |
| Finance | Expenses (Daily Expenses + custom categories) |
| Communication | WhatsApp (invoices, quotations, ledgers, outstanding reminders, payment confirmations, order confirmations) |
| Reporting | Sales, Profit, Expenses, Inventory, Warehouse Stock, Ledgers, Receivables/Payables, Dead/Fast/Slow-moving stock, Purchase, GST |
| Administration | Users, Roles, Permissions, Audit Logs |

### Explicitly deferred (future, not Phase 1 scope)
- Barcode scanning (field reserved on Product, not implemented yet).
- QR code generation (field reserved, not implemented yet).
- Any company beyond Royal Hardware / M52 (architecture must allow it; requirement does not ask us to build it now).

## 5. Users & Roles

- **Admin** — full access to all modules, all companies, all warehouses.
- **Salesman** — sales-floor operations (create sales/invoices/quotations, view relevant stock/customer data); restricted from financial configuration, user management, and other companies' data unless granted.
- **RBAC requirement:** Roles and permissions must be data-driven (stored in DB, assignable per role), not hardcoded, so new roles (e.g. Warehouse Manager, Accountant) can be added later with no code changes.

## 6. Key Business Rules

1. **Inventory is transaction-based.** Stock quantity is never edited directly; it is always the sum of Stock Movements (Purchase, Sale, Transfer, Adjustment, Return, Damage, Correction). Every movement records product, warehouse, quantity, unit, cost, reason, reference document, date, and user.
2. **Company scoping.** Purchases, Sales, Invoices, Quotations, and Ledgers belong to exactly one company (Royal Hardware or M52). Products, Warehouses, Customers, Suppliers, Categories, Brands, and Units are shared across companies.
3. **Warehouses are independent.** Each warehouse tracks its own stock; transfers between warehouses are their own auditable transaction type, not a direct edit.
4. **Units are convertible, not fixed.** A product may be purchased in one unit and sold in another (e.g. 1 Sack = 20 Boxes = 200 Packs = 20,000 Pieces); conversion factors are configurable per product/unit pair, not hardcoded.
5. **One Sales table, channel-differentiated.** All sales (SHOP, WEB, M52, BALOCHISTAN) live in a single unified structure distinguished by a Sales Channel field — no per-channel duplicate tables.
6. **Nothing is hard-deleted.** All deletions are soft deletes; every create/update/delete is captured in the Audit Log (user, old value, new value, timestamp, IP, browser, reason).
7. **Ledgers are derived, not manually keyed.** Customer and Supplier ledgers reflect opening balance + transactions (sales, purchases, payments) rather than being manually adjusted balances.
8. **GST-ready throughout.** Products, invoices, and reports must carry GST correctly per company.

## 7. Assumptions

- Royal Hardware and M52 report GST/taxes separately as distinct entities, even though they share product/customer/supplier master data.
- "Single Branch" means one physical business location; multiple warehouses (Warehouse/Shop/Transit) exist within that single branch/location.
- WhatsApp sending will require a verified Meta Business/WhatsApp Business Account and pre-approved message templates before go-live; this is a business/compliance task that runs in parallel with development, not a code dependency of earlier phases.
- Historical data migration from the existing desktop software is expected but its scope (what data, how far back) will be defined in a later phase once the desktop system's export capabilities are reviewed.

## 8. Success Criteria

The BRD is considered satisfied when the delivered system allows Royal Hardware to:
- Stop using the desktop software entirely for inventory, sales, purchases, and ledgers.
- Produce accurate, separate financial pictures for Royal Hardware and M52 from shared inventory data.
- Trace any stock quantity back to the exact movements that produced it.
- Send a customer an invoice or ledger statement via WhatsApp directly from the system.
- Give an Admin a single dashboard view of today's sales, profit, expenses, cash position, and outstanding balances across all warehouses and both companies.

## 9. Open Items Carried Into Later Phases

- Exact GST rate(s)/rules per product category — needed by Phase 3 (Database Design).
- Full list of expense categories beyond the examples given — needed by Phase 3.
- Desktop software's export format for historical data migration — needed before Phase 9 (Backend Development).
- Meta WhatsApp Business Account verification (business task, not engineering) — needed before Phase 10/WhatsApp module goes live.

---

**Next Step:** On approval of this BRD, proceed to **Phase 2 — Functional Requirements Specification**, which will translate each module above into detailed functional requirements (field-level behavior, workflows, validation rules) before any database or UI design begins.
