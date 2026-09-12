import "server-only";
import { inArray, isNull, or, sql, type Column, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { documents, expenses, bankAccounts, cashAccounts, items } from "@/lib/db/schema";
import type { DashboardData } from "@/lib/actions/dashboard";

type Scopes = { sales: string[]; purchases: string[]; expenses: string[]; accounts: string[]; stock: string[] };
function scope(column: Column, ids: string[], global = false): SQL {
  if (!ids.length) return global ? isNull(column) : sql`false`;
  return (global ? or(isNull(column), inArray(column, ids)) : inArray(column, ids))!;
}

// One statement snapshot for all dashboard totals. The database reduces stock
// movements to totals before transmission instead of returning every stock group.
export async function loadDashboard(today: string, scopes: Scopes): Promise<DashboardData> {
  const sale = sql`document_types.code = 'SALES_INVOICE' and documents.status = 'posted' and ${scope(documents.companyId, scopes.sales)}`;
  const purchase = sql`document_types.code = 'PURCHASE_INVOICE' and documents.status = 'posted' and ${scope(documents.companyId, scopes.purchases)}`;
  const [result] = await db.execute<DashboardData & Record<string, unknown>>(sql`
    WITH money AS (
      SELECT coalesce(sum(documents.grand_total) FILTER (WHERE ${sale} AND documents.document_date = ${today}), 0)::float8 AS sales,
        coalesce(sum(documents.grand_total) FILTER (WHERE ${purchase} AND documents.document_date = ${today}), 0)::float8 AS purchases,
        coalesce(sum(greatest(documents.grand_total - documents.paid_amount, 0)) FILTER (WHERE ${sale}), 0)::float8 AS receivables,
        coalesce(sum(greatest(documents.grand_total - documents.paid_amount, 0)) FILTER (WHERE ${purchase}), 0)::float8 AS payables
      FROM documents JOIN document_types ON document_types.id = documents.document_type_id
      WHERE ${sale} OR ${purchase}
    ), stock AS (
      SELECT items.id AS item_id, coalesce(locations.name, 'Unassigned') AS location,
        sum(inventory_transactions.movement * inventory_transactions.base_quantity) AS on_hand,
        coalesce(sum(inventory_transactions.total_cost) FILTER (WHERE inventory_transactions.movement = 1), 0) AS cost_sum,
        coalesce(sum(inventory_transactions.base_quantity) FILTER (WHERE inventory_transactions.movement = 1), 0) AS cost_qty
      FROM inventory_transactions
      JOIN document_lines ON document_lines.id = inventory_transactions.document_line_id
      JOIN items ON items.id = document_lines.item_id
      LEFT JOIN locations ON locations.id = document_lines.location_id
      WHERE ${scope(items.companyId, scopes.stock)} GROUP BY items.id, locations.name
    ), valued AS (
      SELECT *, CASE WHEN cost_qty > 0 THEN on_hand * cost_sum / cost_qty ELSE 0 END AS value FROM stock
    ), warehouses AS (
      SELECT location AS name, sum(value)::float8 AS value, count(*) FILTER (WHERE on_hand <= 0)::int AS "outOfStock"
      FROM valued GROUP BY location
    ), top_products AS (
      SELECT items.name, coalesce(max(units.symbol), '') AS unit, sum(document_lines.base_quantity)::float8 AS "unitsSold"
      FROM document_lines JOIN documents ON documents.id = document_lines.document_id
      JOIN document_types ON document_types.id = documents.document_type_id
      JOIN items ON items.id = document_lines.item_id LEFT JOIN units ON units.id = document_lines.unit_id
      WHERE ${sale} GROUP BY items.name ORDER BY sum(document_lines.base_quantity) DESC, items.name LIMIT 5
    )
    SELECT ${today}::text AS today, money.sales AS "todaySales", money.purchases AS "todayPurchases", money.receivables, money.payables,
      (SELECT coalesce(sum(amount), 0)::float8 FROM expenses WHERE expense_date = ${today} AND status = 'posted' AND ${scope(expenses.companyId, scopes.expenses)}) AS "todayExpenses",
      (SELECT coalesce(sum(current_balance), 0)::float8 FROM bank_accounts WHERE is_active AND ${scope(bankAccounts.companyId, scopes.accounts, true)}) +
      (SELECT coalesce(sum(current_balance), 0)::float8 FROM cash_accounts WHERE is_active AND ${scope(cashAccounts.companyId, scopes.accounts)}) AS "cashPosition",
      (SELECT coalesce(sum(value), 0)::float8 FROM valued) AS "inventoryValue",
      (SELECT count(*)::int FROM (SELECT item_id FROM stock GROUP BY item_id HAVING sum(on_hand) <= 0) empty_items) AS "outOfStock",
      (SELECT coalesce(jsonb_agg(to_jsonb(top_products) ORDER BY "unitsSold" DESC, name), '[]') FROM top_products) AS "topProducts",
      (SELECT coalesce(jsonb_agg(to_jsonb(warehouses) ORDER BY value DESC, name), '[]') FROM warehouses) AS warehouses
    FROM money
  `);
  return result;
}
