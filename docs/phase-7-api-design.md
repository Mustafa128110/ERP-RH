# Royal Hardware ERP — API Design

**Phase:** 7 of 12
**Status:** Draft for approval
**Depends on:** [Phase 3 — Database Design](phase-3-database-design.md), [Phase 5 — Folder Structure](phase-5-folder-structure.md), [Phase 6 — UI Wireframes](phase-6-ui-wireframes.md)

This defines the contract layer between UI and backend: every Server Action's input/output shape, the permission check every one of them runs, and the handful of Route Handlers that exist for callers that aren't the UI itself. Phase 9 implements exactly this.

---

## 0. Cross-Cutting Conventions

### 0.1 One result shape, everywhere

Every Server Action — read or write — returns the same discriminated union, never throws to the caller:

```ts
type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: ErrorCode; message: string; fieldErrors?: Record<string, string[]> } };

type ErrorCode =
  | "VALIDATION_ERROR"   // Zod parse failed — fieldErrors populated
  | "PERMISSION_DENIED"  // session lacks the required permission/company/warehouse scope
  | "NOT_FOUND"
  | "CONFLICT"           // business-rule conflict: insufficient stock, already posted, threshold breach
  | "RATE_LIMITED"
  | "EXTERNAL_SERVICE_ERROR"; // Meta WhatsApp API, Google Drive, etc. failed
```

A single shape means every module's TanStack Query hook unwraps results identically and every form surfaces `fieldErrors` the same way — no per-module bespoke error handling.

### 0.2 Every action follows the same five steps

```
1. resolve session (Supabase Auth) →
2. requirePermission(session, module, action, { companyId?, warehouseId? }) →
3. schema.parse(input)  — Zod, server-side, always — client validation is UX only, never trusted →
4. delegate to the module's service (never touch the database/Drizzle from the action itself) →
5. return ActionResult
```
`requirePermission` throwing is caught once, centrally, and converted to `PERMISSION_DENIED` — individual actions never write their own auth-check logic.

### 0.3 Reads are Server Actions too — no parallel REST layer

Per the Phase 5 decision, list/search/detail reads (`listProducts`, `getCustomerLedger`, etc.) are Server Actions, called directly by Server Components for initial page load and by TanStack Query hooks (as the `queryFn`) for client-side refetch/pagination. This avoids maintaining a second REST surface that mirrors the same modules. Standard list contract:

```ts
interface ListQuery {
  page: number;
  pageSize: number;
  search?: string;
  sort?: { field: string; dir: "asc" | "desc" }[];
  filters?: Record<string, unknown>;   // module-specific — categoryId, warehouseId, dateRange, etc.
}
interface Paginated<T> { items: T[]; total: number; page: number; pageSize: number; }
```

### 0.4 Route Handlers are the exception, not the default

`app/api/` exists only for callers that are **not** the ERP's own UI making its own request:

| Path | Method | Caller | Why it can't be a Server Action |
|---|---|---|---|
| `/api/webhooks/whatsapp` | POST | Meta (delivery status callbacks) | External system, not our UI |
| `/api/cron/backup` | GET | Vercel Cron | No user session exists to attach a Server Action to |
| `/api/invoices/[saleId]/pdf` | GET | Browser (direct link/new tab, print) | Needs a real URL returning a binary PDF stream, not JSON |
| `/api/reports/export` | GET | Browser (file download) | Same — a download needs a URL, not an action result |

Everything else stays a Server Action.

### 0.5 Posting is atomic and idempotent by construction

Every "post" action (`postSale`, `postPurchase`, `receiveStockTransfer`, `approveStockAdjustment`) performs its status transition as a single conditional update inside the DB transaction that also writes the stock movements/ledger entries:

```sql
UPDATE sales SET status = 'posted', posted_at = now()
WHERE id = $1 AND status = 'draft'
RETURNING *;
```
If zero rows come back, the action returns `CONFLICT` ("Already posted") instead of silently re-posting. This is what makes a double-click or a client retry safe without needing a separate idempotency-key table.

### 0.6 File uploads

Product images and expense receipt attachments are handled as Server Actions accepting `FormData`, streaming directly to Supabase Storage server-side (service-role key never reaches the client); the action returns the public/signed URL to store on the record. No separate upload Route Handler is needed — Next.js Server Actions support file-bearing `FormData` natively.

### 0.7 Rate limiting

- Login attempts: rate-limited per email+IP at the Supabase Auth layer (configured in Phase 8).
- `sendTemplateMessage` (WhatsApp): rate-limited per recipient (e.g. max 1 reminder per customer per hour) to avoid spamming a customer and to respect Meta's own rate tiers.
- `/api/webhooks/whatsapp`: verified via Meta's signature header before processing — not user-rate-limited, but rejects unsigned requests outright.

---

## 1. Module Action Catalog

### 1.1 Standard CRUD pattern (master/lookup data)

Applies identically to: Categories, Sub-Categories, Brands, Units, Warehouses, Expense Categories, Sales Channels, Roles (list/detail).

| Action | Input | Output | Permission |
|---|---|---|---|
| `list<Entity>(query: ListQuery)` | filters per entity | `ActionResult<Paginated<Entity>>` | `<module>.view` |
| `get<Entity>(id)` | id | `ActionResult<Entity>` | `<module>.view` |
| `create<Entity>(input)` | entity fields | `ActionResult<Entity>` | `<module>.create` |
| `update<Entity>(id, input)` | partial fields | `ActionResult<Entity>` | `<module>.edit` |
| `archive<Entity>(id)` | id | `ActionResult<void>` | `<module>.delete` — blocked with `CONFLICT` if referenced by any transaction (FR-CAT-002) |

### 1.2 Products (`modules/inventory/products`)

| Action | Input | Output | Notes |
|---|---|---|---|
| `listProducts(query)` | `+ { categoryId?, brandId?, warehouseId?, status? }` | `Paginated<ProductListItem>` | `ProductListItem` includes `stockOnHand` for the given `warehouseId` (defaults to session's active warehouse) |
| `getProduct(id)` | id | `ProductDetail` (incl. suppliers, conversions, thresholds, per-warehouse avg cost) | Cost/avg-cost fields omitted entirely from the payload for Salesman sessions (FR-USER-010) |
| `createProduct(input)` | full product form | `Product` | SKU uniqueness checked in-transaction |
| `updateProduct(id, input)` | partial | `Product` | |
| `archiveProduct(id)` | id | `void` | `CONFLICT` if any `stock_movements` reference this product (FR-PROD-002) |
| `setUnitConversions(productId, conversions[])` | `{fromUnitId, toUnitId, factor}[]` | `void` | Validates the chain resolves (FR-UNIT-002) before saving |
| `setStockThresholds(productId, warehouseId, min, max)` | — | `void` | |
| `uploadProductImage(productId, formData)` | file | `{url}` | Streams to Supabase Storage |

### 1.3 Stock (`modules/inventory/stock*`)

| Action | Input | Output | Notes |
|---|---|---|---|
| `getStockBalance(productId, warehouseId)` | — | `{ quantityOnHand, averageCost }` | Reads the cache table (§0.2 of Phase 3), never sums movements live |
| `listStockMovements(query)` | `{ productId?, warehouseId?, dateRange?, reason?, userId? }` | `Paginated<StockMovement>` | Read-only (FR-HIST-001) |
| `createStockTransfer(input)` | `{ fromWarehouseId, toWarehouseId, items[] }` | `StockTransfer` | Posts the outbound movement immediately, status → `in_transit` (FR-XFER-001/002) |
| `receiveStockTransfer(id, receivedItems[])` | `{ productId, quantityReceived }[]` | `StockTransfer` | Posts inbound movement(s); any qty mismatch populates `variance_quantity` and returns a `requiresAdjustment: true` flag (FR-XFER-003) |
| `rejectStockTransfer(id, reason)` | reason | `StockTransfer` | Reverses the outbound movement |
| `createStockAdjustment(input)` | `{ warehouseId, reason, note?, items[] }` | `StockAdjustment` | Service computes draft vs. `pending_approval` from the configured threshold (FR-ADJ-002) |
| `approveStockAdjustment(id)` | id | `StockAdjustment` | Permission: `stock_adjustments.approve` — posts movements atomically |
| `rejectStockAdjustment(id, reason)` | reason | `StockAdjustment` | |

### 1.4 Purchases (`modules/purchases/*`)

| Action | Input | Output | Notes |
|---|---|---|---|
| `createPurchase(input)` | `{ companyId, type, supplierId, warehouseId, items[], importDetails? }` | `Purchase` (draft) | `type: "import"` forces `companyId = M52` server-side regardless of what's submitted (FR-PUR-001) |
| `updatePurchase(id, input)` | partial | `Purchase` | Only while `status = draft` |
| `postPurchase(id)` | id | `Purchase` | Atomic transition (§0.5); posts stock movements, updates Average Cost, writes Supplier Ledger entry (FR-PUR-003/004) |
| `createPurchaseReturn(purchaseId, input)` | items/qty | `PurchaseReturn` | Only against a posted Purchase (FR-PUR-005) |
| A posted Purchase is never cancelled directly — corrections happen via `createPurchaseReturn`. | | | |

### 1.5 Sales, Invoices, Quotations, Customers (`modules/sales/*`)

| Action | Input | Output | Notes |
|---|---|---|---|
| `createSale(input)` | `{ salesChannelId, customerId, warehouseId, items[] }` | `Sale` (draft) | `companyId` resolved from `salesChannelId` mapping and stamped at post time, not at draft creation (§0.3, Phase 3) |
| `postSale(id, options?: { allowNegativeStock? })` | id | `Sale` | Blocks if any line exceeds stock unless `allowNegativeStock` is set by an Admin session (logged) (FR-SALE-004) |
| `createSalesReturn(saleId, input)` | items/qty | `SalesReturn` | |
| `getInvoicePdf` | — | — | Route Handler, see §0.4 |
| `sendInvoiceWhatsapp(saleId)` | id | `{ messageId }` | Delegates to WhatsApp module |
| `createQuotation(input)` | items, validUntil | `Quotation` (draft) | No stock/ledger effect (FR-QUO-003) |
| `sendQuotation(id)` | id | `Quotation` | status → `sent`, triggers WhatsApp send |
| `convertQuotation(id, lines: {quotationItemId, qty}[])` | — | `{ sale: Sale }` | Creates a Sale, records `quotation_conversions`, updates `converted_quantity`, sets status to `converted` or `partially_converted` (FR-QUO-002) |
| `listCustomers(query)` / `getCustomer(id)` / `createCustomer` / `updateCustomer` | — | — | Standard pattern; `getCustomer` includes per-company balances |

### 1.6 Ledgers (`modules/sales/customers`, `modules/purchases/suppliers`)

| Action | Input | Output | Notes |
|---|---|---|---|
| `getCustomerLedger(customerId, companyId, query)` | date range | `Paginated<LedgerEntry> + { balance }` | Balance replayed from entries, never stored as an editable field (FR-CUST-002) |
| `recordCustomerPayment(customerId, companyId, input)` | amount, method, note | `LedgerEntry` | |
| `getSupplierLedger(supplierId, companyId, query)` | — | — | Mirrors customer ledger |
| `recordSupplierPayment(supplierId, companyId, input)` | — | `LedgerEntry` | |
| `sendLedgerStatement(entityType, entityId, companyId)` | — | `{ messageId }` | WhatsApp |

### 1.7 Expenses

| Action | Input | Output | Notes |
|---|---|---|---|
| `listExpenses(query)` / `createExpense(input)` | — | — | Standard pattern |
| `cancelExpense(id, reason)` | reason required | `Expense` | Status-based void, not delete (§0.1, Phase 3) |

### 1.8 WhatsApp (`modules/whatsapp`)

| Action | Input | Output | Notes |
|---|---|---|---|
| `sendTemplateMessage(input)` | `{ type, recipientType, recipientId, referenceId }` | `{ messageId, status }` | Internal helper invoked by `sendInvoiceWhatsapp`, `sendQuotation`, `sendLedgerStatement` — not exposed as a raw free-form action to avoid template-less sends (Meta requires pre-approved templates, FR-WA-001) |
| `POST /api/webhooks/whatsapp` | Meta payload | 200 OK | Route Handler; updates `whatsapp_messages_log.status/delivered_at` (FR-WA-002) |

### 1.9 Reports

| Action | Input | Output | Notes |
|---|---|---|---|
| `runReport(input)` | `{ type, dateRange, companyId?, warehouseId?, ...filters }` | `ReportResult` (shape varies by `type`) | `type = "profit"` uses `sale_items.cost_at_time`, never live Average Cost (FR-RPT-003) |
| `GET /api/reports/export?...` | same filters as query string | file stream (CSV/PDF) | Route Handler — needs a downloadable URL |

### 1.10 Users, Roles, Permissions, Audit

| Action | Input | Output | Notes |
|---|---|---|---|
| `listUsers` / `createUser` / `updateUserAccess(userId, {companyIds, warehouseIds})` / `deactivateUser` | — | — | `createUser` provisions via Supabase Auth admin API, then creates the ERP-side profile row |
| `listRoles` / `createRole` / `updateRolePermissions(roleId, permissionIds[])` | — | — | Directly edits `role_permissions` — this **is** the Settings → Roles screen from Phase 6 |
| `listAuditLogs(query)` | `{ tableName?, recordId?, userId?, dateRange? }` | `Paginated<AuditLog>` | Permission: `audit.view`, Admin-only by default seed; read-only, no write action exists at all |

### 1.11 Settings & Backups

| Action | Input | Output | Notes |
|---|---|---|---|
| `getSetting(key, companyId?)` / `updateSetting(key, value, companyId?)` | — | — | Backs the channel→company mapping, GST defaults, thresholds (FR-SET-001) |
| `runManualBackup()` | — | `Backup` | Enqueues the backup job |
| `listBackups(query)` | — | `Paginated<Backup>` | |
| `GET /api/cron/backup` | Vercel Cron header secret | 200 OK | Not user-callable; validates a shared secret, not a user session |

### 1.12 Global Search

| Action | Input | Output | Notes |
|---|---|---|---|
| `globalSearch(query: string)` | free text | `{ products: [], customers: [], suppliers: [], sales: [], purchases: [], quotations: [], warehouses: [] }` grouped result | Each group filtered server-side by the session's permissions before returning — a Salesman's result never includes a `suppliers` or `purchases` group (FR-SRCH-001) |

---

## 2. Open Items Carried Into Phase 8/9

- Exact rate-limit thresholds (login attempts, WhatsApp sends per recipient) need real numbers — modeled as configurable, not hardcoded.
- `allowNegativeStock` override on `postSale`: confirm this should be Admin-only vs. a dedicated permission (`sales.override_stock`) — currently modeled as Admin-only by default.
- PDF generation library choice (e.g. React-PDF vs. a headless-browser renderer) is a Phase 9 implementation detail, not an API contract concern — the contract only fixes that `/api/invoices/[saleId]/pdf` returns `application/pdf`.

---

**Next Step:** On approval, proceed to **Phase 8 — Authentication**, defining the Supabase Auth session model, RBAC enforcement (`requirePermission`), and Row Level Security policies that back every permission check in this catalog.
