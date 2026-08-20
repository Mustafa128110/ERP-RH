import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";

export interface ItemOptionRow {
  [key: string]: unknown;
  id: string;
  name: string;
  sku: string;
  companyId: string;
  baseUnitId: string | null;
  taxable: boolean;
  rate: string | null;
  salesRate: string | null;
}

// One statement supplies the commerce forms with products and their latest
// purchase/sale rates. The former implementation sent three independent
// statements over the remote connection and joined their results in JS.
export function queryItemOptions(scope: SQL | undefined): Promise<ItemOptionRow[]> {
  return db.execute<ItemOptionRow>(sql`
    WITH purchase_rates AS (
      SELECT DISTINCT ON (dl.item_id)
             dl.item_id,
             coalesce(dl.unit_cost, dl.unit_price) * dl.quantity / nullif(dl.base_quantity, 0) AS rate
      FROM document_lines dl
      JOIN documents d ON d.id = dl.document_id
      JOIN document_types dt ON dt.id = d.document_type_id
      WHERE dt.code IN ('PURCHASE_INVOICE', 'STOCK_OPENING')
        AND d.status = 'posted'
        AND dl.item_id IS NOT NULL
        AND dl.base_quantity > 0
      ORDER BY dl.item_id, d.document_date DESC, d.created_at DESC, dl.line_no DESC
    ),
    sales_rates AS (
      SELECT DISTINCT ON (dl.item_id)
             dl.item_id,
             dl.unit_price * dl.quantity / nullif(dl.base_quantity, 0) AS rate
      FROM document_lines dl
      JOIN documents d ON d.id = dl.document_id
      JOIN document_types dt ON dt.id = d.document_type_id
      WHERE dt.code = 'SALES_INVOICE'
        AND d.status = 'posted'
        AND dl.item_id IS NOT NULL
        AND dl.base_quantity > 0
      ORDER BY dl.item_id, d.document_date DESC, d.created_at DESC, dl.line_no DESC
    )
    SELECT items.id,
           items.name,
           items.sku,
           items.company_id AS "companyId",
           items.base_unit_id AS "baseUnitId",
           items.taxable,
           purchase_rates.rate,
           sales_rates.rate AS "salesRate"
    FROM items
    LEFT JOIN purchase_rates ON purchase_rates.item_id = items.id
    LEFT JOIN sales_rates ON sales_rates.item_id = items.id
    WHERE ${scope ?? sql`true`}
    ORDER BY items.name
  `);
}
