import "server-only";
import {sql, type SQL} from "drizzle-orm";
import {db} from "@/lib/db";

export type ProfitPeriod = {period:string;revenue:string;cost:string;grossProfit:string;expenses:string;adjustments:string;netProfit:string;documents:number};
export type ProfitCalendar = {months:ProfitPeriod[];days:ProfitPeriod[];month:string|null;canExport:boolean};

// Recorded costs and posted returns preserve the margin of older months. Payments
// never count as revenue a second time. Tax collected is excluded from revenue.
export async function queryProfitCalendar(companies:SQL,channel:string|undefined,month?:string) {
 const source=sql`WITH sales AS (
  SELECT d.document_date AS day,(CASE WHEN dt.code='SALES_RETURN' THEN -1 ELSE 1 END) AS sign,
    d.subtotal-d.discount_total+d.shipping_total-CASE WHEN d.tax_inclusive THEN d.tax_total ELSE 0 END AS revenue,
    coalesce(cost.value,0) AS cost
  FROM documents d JOIN document_types dt ON dt.id=d.document_type_id
  LEFT JOIN LATERAL (SELECT sum(coalesce(m.value,dl.quantity*coalesce(dl.unit_cost,0))) AS value FROM document_lines dl
    LEFT JOIN LATERAL (SELECT sum(it.total_cost) AS value FROM inventory_transactions it WHERE it.document_line_id=dl.id) m ON true
    WHERE dl.document_id=d.id) cost ON true
  WHERE dt.code IN ('SALES_INVOICE','SALES_RETURN') AND d.status='posted' AND d.company_id IN (${companies})
    AND ${channel?sql`coalesce(d.sale_type,'counter')=${channel}`:sql`true`}
 ), spending AS (
  SELECT e.expense_date AS day,sum(e.amount) AS expenses FROM expenses e
  WHERE e.status='posted' AND e.company_id IN (${companies}) AND ${channel?sql`e.sale_type=${channel}`:sql`true`} GROUP BY e.expense_date
 ), adjustments AS (
  SELECT d.document_date AS day,sum(le.debit-le.credit) AS adjustments FROM documents d JOIN document_types dt ON dt.id=d.document_type_id JOIN ledger_entries le ON le.document_id=d.id
  WHERE dt.code::text='LEDGER_CLOSING' AND d.status='posted' AND d.company_id IN (${companies}) AND ${channel?sql`d.sale_type=${channel}`:sql`true`} GROUP BY d.document_date
 ), daily AS (
  SELECT day,sum(revenue) AS revenue,sum(cost) AS cost,sum(expenses) AS expenses,sum(adjustments) AS adjustments,sum(documents)::int AS documents FROM (
    SELECT day,sum(sign*revenue) AS revenue,sum(sign*cost) AS cost,0::numeric AS expenses,0::numeric AS adjustments,count(*)::int AS documents FROM sales GROUP BY day
    UNION ALL SELECT day,0,0,expenses,0,0 FROM spending
    UNION ALL SELECT day,0,0,0,adjustments,0 FROM adjustments
  ) entries GROUP BY day
 )`;
 const [result]=await db.execute<{months:ProfitPeriod[];days:ProfitPeriod[]}>(sql`${source}
 SELECT coalesce((SELECT jsonb_agg(row ORDER BY period DESC) FROM (
   SELECT to_char(day,'YYYY-MM') AS period,sum(revenue)::text AS revenue,sum(cost)::text AS cost,
     sum(revenue-cost)::text AS "grossProfit",sum(expenses)::text AS expenses,sum(adjustments)::text AS adjustments,sum(revenue-cost-expenses+adjustments)::text AS "netProfit",sum(documents)::int AS documents
   FROM daily GROUP BY to_char(day,'YYYY-MM')) row),'[]'::jsonb) AS months,
 coalesce((SELECT jsonb_agg(row ORDER BY period) FROM (
   SELECT dates.day::date::text AS period,coalesce(d.revenue,0)::text AS revenue,coalesce(d.cost,0)::text AS cost,
     coalesce(d.revenue-d.cost,0)::text AS "grossProfit",coalesce(d.expenses,0)::text AS expenses,coalesce(d.adjustments,0)::text AS adjustments,
     coalesce(d.revenue-d.cost-d.expenses+d.adjustments,0)::text AS "netProfit",coalesce(d.documents,0)::int AS documents
   FROM generate_series((${month??null}||'-01')::date,((${month??null}||'-01')::date+interval '1 month -1 day')::date,interval '1 day') dates(day)
   LEFT JOIN daily d ON d.day=dates.day::date) row),'[]'::jsonb) AS days`);
 return {...result,month:month??null};
}
