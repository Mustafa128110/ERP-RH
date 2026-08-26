# ERP integrity remediation — approved decisions

This document records the business decisions approved on 2026-08-26 for the
integrity remediation programme. It is the implementation contract until the
requirements documents are updated phase by phase.

## Posting and inventory

- Sales may post into negative stock. The application must show the resulting
  negative position, but must not block the sale.
- A missing base unit or conversion rule must not block sales or stock posting.
  The entered quantity is stored as provisional stock quantity until a valid
  rule can resolve it.
- A base unit is only the unit used to calculate and report stock on hand. It
  is not required for a conversion rule or for price conversion.
- A product can have multiple product-specific conversion rules. A rule is
  reciprocal and composable: `1 dozen = 12 pieces` also resolves pieces to
  dozens, and may be combined with other rules for the same product.
- Product unit pickers show only the product's base unit and units connected by
  its rules. A product with neither remains sellable using an explicit
  provisional/unitless choice.
- Adding, changing, or removing a base unit or rule recalculates and persists
  affected historical base quantities without changing financial document
  totals or historical entered prices.

## Product setup indicators

- Red dot: missing existing core product details/category.
- Blue dot: no unit conversion rule exists for the product.
- Green dot: no base unit is assigned to the product.
- More than one dot may appear for one product.

## Costing and adjustments

- Inventory value is based on the actual purchase costs of the stock held, not
  a single latest-purchase rate. The approved implementation basis is purchase
  cost layers, depleted FIFO for inventory valuation.
- Sale-line profit costing is not being converted to weighted-average cost in
  this programme.
- Stock adjustment lines offer the latest three purchase records' unique rates
  for the item. Equal rates are shown once, the most recent rate is selected by
  default, and the selected purchase-rate source is retained for audit.

## Financial records and accounting

- Opening-balance direction, concurrent edit/cancel safety, and journal
  authorization are mandatory fixes.
- Financial history is never hard-deleted. Cancelled and reversal entries are
  hidden by default in ledgers and can be revealed with a Show cancelled/reversed
  control.
- Customer/supplier and bank/cash balances become derived from posted journals;
  direct balance rewriting is replaced by controlled adjustment entries.
- The target accounting model is complete double-entry accounting.
- Sales and purchase returns plus credit/debit notes are required.

## Platform and operations

- Production cache invalidation uses a shared Redis-compatible cache rather
  than per-process cache state.
- Private offline caches are isolated by authenticated session. Durable offline
  queues cover commerce and stock create workflows; cancellations and approvals
  remain online-only until separately approved.
- Drizzle and Supabase migrations must remain in parity and CI must enforce it.
- Production requires verified backups, retention/PITR information, and a
  successful scratch-environment restore drill.
- WhatsApp messaging is to be implemented with free `wa.me` handoff by default
  and optional Meta Cloud API delivery when credentials are configured.
- Requirements documents will be updated to reflect these approved behaviours.

## Delivery controls

Every phase includes data repair where required, migrations, automated checks,
rollout and rollback notes, and reconciliation before production cutover.
