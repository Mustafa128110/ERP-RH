import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

async function main() {
  const result = await db.execute(sql.raw(`
    WITH request_integrity AS (
      SELECT r.id
      FROM market_purchase_requests r
      LEFT JOIN documents purchase ON purchase.id = r.confirmation_document_id
      LEFT JOIN document_types purchase_type ON purchase_type.id = purchase.document_type_id
      LEFT JOIN expenses expense ON expense.id = r.expense_id
      WHERE
        (r.status = 'pending' AND (r.confirmation_document_id IS NOT NULL OR r.expense_id IS NOT NULL OR r.purchase_cost IS NOT NULL))
        OR
        (r.status = 'confirmed' AND (
          r.confirmation_document_id IS NULL OR r.expense_id IS NULL OR r.purchase_cost IS NULL
          OR purchase.status <> 'posted' OR purchase_type.code <> 'MARKET_PURCHASE'
          OR expense.status <> 'posted' OR expense.document_id <> purchase.id
        ))
    ), movement_integrity AS (
      SELECT r.id
      FROM market_purchase_requests r
      JOIN document_lines sale_line ON sale_line.id = r.sale_line_id
      JOIN document_lines purchase_line ON purchase_line.document_id = r.confirmation_document_id
        AND purchase_line.item_id = r.item_id
      WHERE r.status = 'confirmed'
      GROUP BY r.id, r.base_quantity
      HAVING
        coalesce(sum(purchase_line.base_quantity), 0) <> r.base_quantity
        OR coalesce(sum(purchase_line.stock_movement * purchase_line.base_quantity), 0) +
           coalesce(max(sale_line.stock_movement * sale_line.base_quantity), 0) <> 0
    )
    SELECT
      (SELECT count(*)::int FROM request_integrity) AS broken_links,
      (SELECT count(*)::int FROM movement_integrity) AS unbalanced_stock
  `));
  const row = result[0] as { broken_links: number; unbalanced_stock: number };
  assert.equal(Number(row.broken_links), 0, "market-purchase status/link invariants are broken");
  assert.equal(Number(row.unbalanced_stock), 0, "a confirmed market purchase does not offset its sale quantity");
  console.log("market-purchase links, expense, and zero-net-stock invariants verified");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
