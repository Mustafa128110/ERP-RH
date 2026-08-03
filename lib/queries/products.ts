import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

// The products list query, split out of lib/actions/products.ts for the same
// reason lib/queries/reports.ts is split out of its action: that file is
// "use server", so nothing in it can be imported and run by a check. This one
// takes an already-resolved company scope and reads no session, which is what
// makes lib/queries/products.check.ts able to run the *actual* query against a
// real database.
//
// That split is not decoration. This query shipped broken — two joins aliased
// `s` (`42712: table name "s" specified more than once`) — because it was
// "verified" by running a hand-copied version of the SQL in a scratch script,
// and the copy had different aliases from the file. A check that imports the
// query cannot drift from it.

// rate_list is a hand-written SQL view (drizzle/0007_create_rate_list_view.sql),
// not modeled in lib/db/schema.ts — queried with a raw sql tag instead of the
// query builder.
export interface ProductRateRow {
  id: string;
  name: string;
  categoryId: string | null;
  // A real purchase invoice always wins here, straight from rate_list. With no
  // purchase history the fallback is the cost typed into the sale's rate column
  // (document_lines.unit_cost) — the only rate an item first seen on a sale line
  // has. Once it is actually purchased, rate_list takes over.
  purchaseRate1: string | null;
  purchaseRate2: string | null;
  purchaseRate3: string | null;
  // Price it last sold at. Not part of rate_list — that view is purchase-only —
  // so it's a LATERAL on the sales lines here.
  salesRate: string | null;
  // The rest is for the hover panel on the item name: the list has room for the
  // name and four rates, and everything a person actually wants to know before
  // opening the record — is there any, what is it, whose is it — was missing.
  sku: string;
  company: string;
  category: string | null;
  brand: string | null;
  onHand: string | null;
}

// `scopeIds` is the set of companies the caller has already established the user
// may see. An empty set means no products at all — items.company_id is NOT NULL,
// so there is no such thing as a global product.
export async function queryProductRates(scopeIds: string[]): Promise<ProductRateRow[]> {
  if (scopeIds.length === 0) return [];

  // Built with sql.join so each id binds as its own parameter — a raw
  // `= ANY(${array})` mis-binds under drizzle's execute().
  const companyList = sql.join(
    scopeIds.map((id) => sql`${id}`),
    sql`, `,
  );

  const rows = await db.execute<{
    id: string;
    name: string;
    sku: string;
    company: string;
    category_id: string | null;
    category: string | null;
    brand: string | null;
    on_hand: string | null;
    purchase_rate_1: string | null;
    purchase_rate_2: string | null;
    purchase_rate_3: string | null;
    sales_rate: string | null;
  }>(sql`
    SELECT rl.id, rl.name, i.sku, co.name AS company, i.category_id,
           cat.name AS category, br.name AS brand, oh.on_hand,
           coalesce(rl.purchase_rate_1, c.unit_cost) AS purchase_rate_1,
           rl.purchase_rate_2, rl.purchase_rate_3,
           s.unit_price AS sales_rate
    FROM rate_list rl
    JOIN items i ON i.id = rl.id
    JOIN companies co ON co.id = i.company_id
    LEFT JOIN categories cat ON cat.id = i.category_id
    LEFT JOIN brands br ON br.id = i.brand_id
    -- One grouped pass over the movement ledger, joined once — not a LATERAL
    -- per row. On-hand for a whole catalogue is a single hash aggregate;
    -- a correlated subquery would rescan the ledger for every item on screen.
    --
    -- Aliased oh, not s: s is the sales-rate lateral below, and two joins with
    -- the same alias is error 42712.
    LEFT JOIN (
      SELECT dl.item_id, sum(it.movement * it.base_quantity) AS on_hand
      FROM inventory_transactions it
      JOIN document_lines dl ON dl.id = it.document_line_id
      GROUP BY dl.item_id
    ) oh ON oh.item_id = rl.id
    LEFT JOIN LATERAL (
      SELECT dl.unit_price
      FROM document_lines dl
      JOIN documents d ON d.id = dl.document_id
      JOIN document_types dt ON dt.id = d.document_type_id
      WHERE dl.item_id = rl.id AND dt.code = 'SALES_INVOICE'
      ORDER BY d.document_date DESC, dl.line_no DESC
      LIMIT 1
    ) s ON true
    LEFT JOIN LATERAL (
      SELECT dl.unit_cost
      FROM document_lines dl
      JOIN documents d ON d.id = dl.document_id
      JOIN document_types dt ON dt.id = d.document_type_id
      WHERE dl.item_id = rl.id AND dt.code = 'SALES_INVOICE' AND dl.unit_cost IS NOT NULL
      ORDER BY d.document_date DESC, dl.line_no DESC
      LIMIT 1
    ) c ON true
    WHERE i.company_id IN (${companyList})
    ORDER BY rl.name`);

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    sku: r.sku,
    company: r.company,
    categoryId: r.category_id,
    category: r.category,
    brand: r.brand,
    onHand: r.on_hand,
    purchaseRate1: r.purchase_rate_1,
    purchaseRate2: r.purchase_rate_2,
    purchaseRate3: r.purchase_rate_3,
    salesRate: r.sales_rate,
  }));
}
