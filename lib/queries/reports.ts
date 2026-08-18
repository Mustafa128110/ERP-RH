import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { formatDateWhenDate, formatMonth, todayISO } from "@/lib/format";
import { REPORT_TYPES, type ReportSlug } from "@/lib/report-constants";

// The SQL behind every report, and the shapes it comes back in.
//
// Split out of lib/actions/reports.ts for the same reason lib/queries/lookups.ts
// is split out of the actions that use it: that file is "use server", so every
// export becomes an HTTP endpoint and only async functions are allowed. The
// permission check stays over there, on the action — nothing here reads a
// session, and nothing here is reachable from a browser.
//
// It also means lib/queries/reports.check.ts can run these statements against a
// real database without a login, which is the only way to find out that a query
// referencing a column that doesn't exist was ever written.

// `date` marks a column whose values are YYYY-MM-DD (or the occasional word,
// like "Never" — formatDateWhenDate handles that); `month` marks a YYYY-MM
// period label. Both are formatted to day-first here in queryReport, once, so
// the web table and the CSV export show the same string.
export type ReportColumn = { key: string; label: string; align?: "right"; money?: boolean; qty?: boolean; date?: boolean; month?: boolean };
export type ReportRow = Record<string, string | number | null>;
export type ReportResult = {
  title: string;
  description: string;
  columns: ReportColumn[];
  rows: ReportRow[];
  // Rendered as a footer line. Keys match column keys.
  totals?: ReportRow;
  // Shown above the table when the report needs a word of explanation about how
  // its numbers are arrived at.
  note?: string;
};

export type ReportFilters = { from?: string; to?: string; company?: string; location?: string };

// Every report is scoped the same way, so the fragments are built once. Company
// scope is not optional and not a filter — it is the boundary of what the signed
// in user may see at all, resolved by the caller before it gets here.
export type Scope = { companies: SQL; from: string; to: string; company: string | null; location: string | null };

const NOTES: Partial<Record<ReportSlug, string>> = {
  profit:
    "Cost is what the item cost when it was sold (document_lines.unit_cost), not what it costs today — a price rise since then does not rewrite last month's margin.",
  "dead-stock": "Items with stock on hand and no sale within their company's configured dead-stock threshold.",
  "receivables-payables": "Age is counted from the document date. A negative balance means it has been overpaid.",
  gst: "Read from the tax recorded on each document, not recomputed from rates — so it agrees with what the invoices actually say.",
};

const COLUMNS: Record<ReportSlug, ReportColumn[]> = {
  sales: [
    { key: "period", label: "Date", date: true },
    { key: "company", label: "Company" },
    { key: "saleType", label: "Channel" },
    { key: "invoices", label: "Invoices", align: "right" },
    { key: "subtotal", label: "Subtotal", align: "right", money: true },
    { key: "discount", label: "Discount", align: "right", money: true },
    { key: "tax", label: "Tax", align: "right", money: true },
    { key: "total", label: "Total", align: "right", money: true },
  ],
  profit: [
    { key: "item", label: "Item" },
    { key: "company", label: "Company" },
    { key: "quantity", label: "Qty Sold", align: "right", qty: true },
    { key: "revenue", label: "Revenue", align: "right", money: true },
    { key: "cost", label: "Cost at Sale", align: "right", money: true },
    { key: "profit", label: "Profit", align: "right", money: true },
    { key: "margin", label: "Margin %", align: "right" },
  ],
  expenses: [
    { key: "category", label: "Category" },
    { key: "company", label: "Company" },
    { key: "count", label: "Entries", align: "right" },
    { key: "amount", label: "Amount", align: "right", money: true },
  ],
  inventory: [
    { key: "sku", label: "SKU" },
    { key: "item", label: "Item" },
    { key: "company", label: "Company" },
    { key: "onHand", label: "On Hand", align: "right", qty: true },
    { key: "value", label: "Value", align: "right", money: true },
  ],
  "warehouse-stock": [
    { key: "location", label: "Location" },
    { key: "sku", label: "SKU" },
    { key: "item", label: "Item" },
    { key: "onHand", label: "On Hand", align: "right", qty: true },
    { key: "value", label: "Value", align: "right", money: true },
  ],
  "customer-ledger": [
    { key: "contact", label: "Customer" },
    { key: "company", label: "Company" },
    { key: "invoiced", label: "Invoiced", align: "right", money: true },
    { key: "paid", label: "Paid", align: "right", money: true },
    { key: "balance", label: "Owes Us", align: "right", money: true },
  ],
  "supplier-ledger": [
    { key: "contact", label: "Supplier" },
    { key: "company", label: "Company" },
    { key: "billed", label: "Billed", align: "right", money: true },
    { key: "paid", label: "Paid", align: "right", money: true },
    { key: "balance", label: "We Owe", align: "right", money: true },
  ],
  "receivables-payables": [
    { key: "kind", label: "Kind" },
    { key: "number", label: "Document" },
    { key: "contact", label: "Contact" },
    { key: "company", label: "Company" },
    { key: "date", label: "Date", date: true },
    { key: "age", label: "Days", align: "right" },
    { key: "balance", label: "Outstanding", align: "right", money: true },
  ],
  "dead-stock": [
    { key: "sku", label: "SKU" },
    { key: "item", label: "Item" },
    { key: "company", label: "Company" },
    { key: "onHand", label: "On Hand", align: "right", qty: true },
    { key: "lastSold", label: "Last Sold", date: true },
    { key: "value", label: "Value", align: "right", money: true },
  ],
  purchase: [
    { key: "period", label: "Date", date: true },
    { key: "supplier", label: "Supplier" },
    { key: "company", label: "Company" },
    { key: "invoices", label: "Invoices", align: "right" },
    { key: "total", label: "Total", align: "right", money: true },
  ],
  gst: [
    { key: "period", label: "Month", month: true },
    { key: "company", label: "Company" },
    { key: "salesTax", label: "Tax on Sales", align: "right", money: true },
    { key: "purchaseTax", label: "Tax on Purchases", align: "right", money: true },
    { key: "net", label: "Net Payable", align: "right", money: true },
  ],
};

type Query = (s: Scope) => Promise<ReportRow[]>;

// Each report is one statement. `document_date` is a date column, so the range
// comparisons are index-friendly rather than wrapped in a cast.
const QUERIES: Record<ReportSlug, Query> = {
  sales: async (s) =>
    db.execute<ReportRow>(sql`
      SELECT d.document_date::text AS period,
             c.name AS company,
             coalesce(d.sale_type::text, 'counter') AS "saleType",
             count(*)::int AS invoices,
             sum(d.subtotal) AS subtotal,
             sum(d.discount_total) AS discount,
             sum(d.tax_total) AS tax,
             sum(d.grand_total) AS total
        FROM documents d
        JOIN document_types dt ON dt.id = d.document_type_id
        JOIN companies c ON c.id = d.company_id
       WHERE dt.code = 'SALES_INVOICE'
         AND d.status = 'posted'
         AND d.company_id IN (${s.companies})
         AND d.document_date BETWEEN ${s.from} AND ${s.to}
       GROUP BY d.document_date, c.name, d.sale_type
       ORDER BY d.document_date DESC, c.name`),

  profit: async (s) =>
    db.execute<ReportRow>(sql`
      SELECT i.name AS item,
             c.name AS company,
             sum(dl.quantity) AS quantity,
             sum(dl.line_total) AS revenue,
             -- unit_cost is what it cost at the time of sale. NULL where a sale
             -- predates cost tracking; treated as zero rather than dropping the
             -- row, so revenue still adds up to the sales report.
             sum(dl.quantity * coalesce(dl.unit_cost, 0)) AS cost,
             sum(dl.line_total) - sum(dl.quantity * coalesce(dl.unit_cost, 0)) AS profit,
             CASE WHEN sum(dl.line_total) > 0
                  THEN round(100 * (sum(dl.line_total) - sum(dl.quantity * coalesce(dl.unit_cost, 0))) / sum(dl.line_total), 1)::text || '%'
                  ELSE '—' END AS margin
        FROM document_lines dl
        JOIN documents d ON d.id = dl.document_id
        JOIN document_types dt ON dt.id = d.document_type_id
        JOIN companies c ON c.id = d.company_id
        JOIN items i ON i.id = dl.item_id
       WHERE dt.code = 'SALES_INVOICE'
         AND d.status = 'posted'
         AND d.company_id IN (${s.companies})
         AND d.document_date BETWEEN ${s.from} AND ${s.to}
       GROUP BY i.name, c.name
       ORDER BY profit DESC`),

  expenses: async (s) =>
    db.execute<ReportRow>(sql`
      SELECT ec.name AS category,
             c.name AS company,
             count(*)::int AS count,
             sum(e.amount) AS amount
        FROM expenses e
        JOIN expense_categories ec ON ec.id = e.expense_category_id
        JOIN companies c ON c.id = e.company_id
       WHERE e.company_id IN (${s.companies})
         AND e.status = 'posted'
         AND e.expense_date BETWEEN ${s.from} AND ${s.to}
       GROUP BY ec.name, c.name
       ORDER BY amount DESC`),

  inventory: async (s) =>
    db.execute<ReportRow>(sql`
      SELECT i.sku, i.name AS item, c.name AS company,
             sum(it.movement * it.base_quantity) AS "onHand",
             sum(it.movement * coalesce(it.total_cost, 0)) AS value
        FROM inventory_transactions it
        JOIN document_lines dl ON dl.id = it.document_line_id
        JOIN items i ON i.id = dl.item_id
        JOIN companies c ON c.id = it.company_id
       WHERE it.company_id IN (${s.companies})
       GROUP BY i.sku, i.name, c.name
      HAVING sum(it.movement * it.base_quantity) <> 0
       ORDER BY value DESC`),

  "warehouse-stock": async (s) =>
    db.execute<ReportRow>(sql`
      SELECT coalesce(l.name, 'Unassigned') AS location,
             i.sku, i.name AS item,
             sum(it.movement * it.base_quantity) AS "onHand",
             sum(it.movement * coalesce(it.total_cost, 0)) AS value
        FROM inventory_transactions it
        JOIN document_lines dl ON dl.id = it.document_line_id
        JOIN items i ON i.id = dl.item_id
        LEFT JOIN locations l ON l.id = dl.location_id
       WHERE it.company_id IN (${s.companies})
         ${s.location ? sql`AND dl.location_id = ${s.location}::uuid` : sql``}
       GROUP BY l.name, i.sku, i.name
      HAVING sum(it.movement * it.base_quantity) <> 0
       ORDER BY location, i.name`),

  "customer-ledger": async (s) =>
    db.execute<ReportRow>(sql`
      SELECT ct.display_name AS contact, c.name AS company,
             sum(d.grand_total) AS invoiced,
             sum(d.paid_amount) AS paid,
             sum(d.grand_total - d.paid_amount) AS balance
        FROM documents d
        JOIN document_types dt ON dt.id = d.document_type_id
        JOIN companies c ON c.id = d.company_id
        JOIN contacts ct ON ct.id = d.contact_id
       WHERE dt.code = 'SALES_INVOICE'
         AND d.status = 'posted'
         AND d.company_id IN (${s.companies})
         AND d.document_date BETWEEN ${s.from} AND ${s.to}
       GROUP BY ct.display_name, c.name
       ORDER BY balance DESC`),

  "supplier-ledger": async (s) =>
    db.execute<ReportRow>(sql`
      SELECT ct.display_name AS contact, c.name AS company,
             sum(d.grand_total) AS billed,
             sum(d.paid_amount) AS paid,
             sum(d.grand_total - d.paid_amount) AS balance
        FROM documents d
        JOIN document_types dt ON dt.id = d.document_type_id
        JOIN companies c ON c.id = d.company_id
        JOIN contacts ct ON ct.id = d.contact_id
       WHERE dt.code = 'PURCHASE_INVOICE'
         AND d.status = 'posted'
         AND d.company_id IN (${s.companies})
         AND d.document_date BETWEEN ${s.from} AND ${s.to}
       GROUP BY ct.display_name, c.name
       ORDER BY balance DESC`),

  "receivables-payables": async (s) =>
    db.execute<ReportRow>(sql`
      SELECT CASE WHEN dt.code = 'SALES_INVOICE' THEN 'Receivable' ELSE 'Payable' END AS kind,
             d.number, coalesce(ct.display_name, '—') AS contact, c.name AS company,
             d.document_date::text AS date,
             (CURRENT_DATE - d.document_date)::int AS age,
             (d.grand_total - d.paid_amount) AS balance
        FROM documents d
        JOIN document_types dt ON dt.id = d.document_type_id
        JOIN companies c ON c.id = d.company_id
        LEFT JOIN contacts ct ON ct.id = d.contact_id
       WHERE dt.code IN ('SALES_INVOICE', 'PURCHASE_INVOICE')
         AND d.status = 'posted'
         AND d.company_id IN (${s.companies})
         AND d.grand_total - d.paid_amount <> 0
         AND d.document_date BETWEEN ${s.from} AND ${s.to}
       -- Oldest first: the one that has been waiting longest is the one to chase.
       ORDER BY age DESC`),

  "dead-stock": async (s) =>
    db.execute<ReportRow>(sql`
      WITH on_hand AS (
        SELECT dl.item_id,
               sum(it.movement * it.base_quantity) AS quantity,
               sum(it.movement * coalesce(it.total_cost, 0)) AS value
          FROM inventory_transactions it
          JOIN document_lines dl ON dl.id = it.document_line_id
         WHERE it.company_id IN (${s.companies})
         GROUP BY dl.item_id
        HAVING sum(it.movement * it.base_quantity) > 0
      ), last_sale AS (
        SELECT dl.item_id, max(d.document_date) AS sold_on
          FROM document_lines dl
          JOIN documents d ON d.id = dl.document_id
          JOIN document_types dt ON dt.id = d.document_type_id
         WHERE dt.code = 'SALES_INVOICE'
           AND d.status = 'posted'
         GROUP BY dl.item_id
      )
      SELECT i.sku, i.name AS item, c.name AS company,
             oh.quantity AS "onHand",
             coalesce(ls.sold_on::text, 'Never') AS "lastSold",
             oh.value
        FROM on_hand oh
        JOIN items i ON i.id = oh.item_id
        JOIN companies c ON c.id = i.company_id
        LEFT JOIN last_sale ls ON ls.item_id = oh.item_id
        LEFT JOIN settings dead_setting ON dead_setting.company_id = i.company_id AND dead_setting.key = 'dead_stock_days'
       WHERE ls.sold_on IS NULL
          OR ls.sold_on < CURRENT_DATE - coalesce(nullif(dead_setting.value, '')::int, 90)
       ORDER BY oh.value DESC`),

  purchase: async (s) =>
    db.execute<ReportRow>(sql`
      SELECT d.document_date::text AS period,
             coalesce(ct.display_name, '—') AS supplier,
             c.name AS company,
             count(*)::int AS invoices,
             sum(d.grand_total) AS total
        FROM documents d
        JOIN document_types dt ON dt.id = d.document_type_id
        JOIN companies c ON c.id = d.company_id
        LEFT JOIN contacts ct ON ct.id = d.contact_id
       WHERE dt.code = 'PURCHASE_INVOICE'
         AND d.status = 'posted'
         AND d.company_id IN (${s.companies})
         AND d.document_date BETWEEN ${s.from} AND ${s.to}
       GROUP BY d.document_date, ct.display_name, c.name
       ORDER BY d.document_date DESC`),

  gst: async (s) =>
    db.execute<ReportRow>(sql`
      SELECT to_char(d.document_date, 'YYYY-MM') AS period,
             c.name AS company,
             sum(CASE WHEN dt.code = 'SALES_INVOICE' THEN d.tax_total ELSE 0 END) AS "salesTax",
             sum(CASE WHEN dt.code = 'PURCHASE_INVOICE' THEN d.tax_total ELSE 0 END) AS "purchaseTax",
             sum(CASE WHEN dt.code = 'SALES_INVOICE' THEN d.tax_total ELSE -d.tax_total END) AS net
        FROM documents d
        JOIN document_types dt ON dt.id = d.document_type_id
        JOIN companies c ON c.id = d.company_id
       WHERE dt.code IN ('SALES_INVOICE', 'PURCHASE_INVOICE')
         AND d.status = 'posted'
         AND d.company_id IN (${s.companies})
         AND d.document_date BETWEEN ${s.from} AND ${s.to}
       GROUP BY to_char(d.document_date, 'YYYY-MM'), c.name
       ORDER BY period DESC, c.name`),
};


// Runs one report against an already-resolved scope. The caller is responsible
// for having checked the permission and for having built the scope from the
// session — this function trusts what it is handed, which is why it does not
// live in a "use server" module.
export async function queryReport(slug: ReportSlug, scope: Scope): Promise<ReportResult> {
  const meta = REPORT_TYPES.find((r) => r.slug === slug)!;
  const raw = await QUERIES[slug](scope);
  const columns = COLUMNS[slug];
  // The SQL hands back ISO (or "Never"), so every consumer sees day-first
  // without each one knowing which columns are dates.
  const dateCols = columns.filter((c) => c.date || c.month);
  const rows =
    dateCols.length === 0
      ? raw
      : raw.map((r) => {
          const out = { ...r };
          for (const c of dateCols) {
            const v = out[c.key];
            if (v === null || v === undefined) continue;
            out[c.key] = c.date ? formatDateWhenDate(String(v)) : formatMonth(String(v));
          }
          return out;
        });
  return { title: meta.label, description: meta.desc, columns, rows, totals: totalsFor(columns, rows), note: NOTES[slug] };
}

// Sums every column marked as money or quantity. Returns undefined when there is
// nothing to add up, so the page renders no footer.
function totalsFor(columns: ReportColumn[], rows: ReportRow[]): ReportRow | undefined {
  const summable = columns.filter((c) => c.money || c.qty);
  if (summable.length === 0 || rows.length === 0) return undefined;
  const totals: ReportRow = {};
  for (const c of summable) totals[c.key] = rows.reduce((sum, r) => sum + Number(r[c.key] ?? 0), 0);
  return totals;
}

// The scope every report runs under, built from a set of company ids the caller
// has already established the user may see.
export function reportScope(ids: string[], filters: ReportFilters): Scope | null {
  if (ids.length === 0) return null;
  const company = filters.company && ids.includes(filters.company) ? filters.company : null;
  const visible = company ? [company] : ids;
  return {
    companies: sql.join(
      visible.map((id) => sql`${id}::uuid`),
      sql`, `,
    ),
    // A report with no dates is a report over everything, which for sales is a
    // question nobody asks. Default to this month.
    from: filters.from || todayISO().slice(0, 8) + "01",
    to: filters.to || todayISO(),
    company,
    location: filters.location || null,
  };
}
