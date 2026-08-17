"use server";

import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { getLiveSession, getSession } from "@/lib/auth/session";
import { requirePermission } from "@/lib/auth/permissions";
import { getScopeCompanyIds } from "@/lib/auth/scope";
import { recordAudit } from "@/lib/actions/audit";
import { SNAPSHOT_TABLES } from "@/lib/backup-constants";

// The old Backups screen listed three invented backup files and a disabled "Run
// Backup Now" button. This is what a web app can honestly offer instead:
//
//   * a plain statement of where real backups come from — the database host, not
//     this process. Nothing running inside a Next server can take a consistent
//     dump of the database it is connected to, and pretending otherwise is how
//     people discover they had no backups on the day they needed one.
//   * an export of the data that matters, as CSV, on demand. That is a real
//     safety net: it opens in a spreadsheet, it survives this app being gone,
//     and it is what a small business actually reaches for.

const QUERIES: Record<string, (companies: string) => ReturnType<typeof db.execute>> = {
  products: (c) => db.execute(sql`
    SELECT i.sku, i.name, i.urdu_name AS urdu_name, co.name AS company, cat.name AS category, b.name AS brand, i.taxable, i.is_active
      FROM items i JOIN companies co ON co.id = i.company_id
      LEFT JOIN categories cat ON cat.id = i.category_id
      LEFT JOIN brands b ON b.id = i.brand_id
     WHERE i.company_id IN (${sql.raw(c)}) ORDER BY i.name`),

  contacts: (c) => db.execute(sql`
    SELECT ct.display_name, ct.company_name, ct.phone, ct.email, ct.city, ct.tax_number, ct.credit_limit, ct.is_active, co.name AS company
      FROM contacts ct LEFT JOIN companies co ON co.id = ct.company_id
     WHERE ct.company_id IS NULL OR ct.company_id IN (${sql.raw(c)}) ORDER BY ct.display_name`),

  stock: (c) => db.execute(sql`
    SELECT i.sku, i.name AS item, coalesce(l.name, 'Unassigned') AS location, u.name AS unit,
           sum(it.movement * it.base_quantity) AS on_hand,
           sum(it.movement * coalesce(it.total_cost, 0)) AS value
      FROM inventory_transactions it
      JOIN document_lines dl ON dl.id = it.document_line_id
      JOIN items i ON i.id = dl.item_id
      LEFT JOIN locations l ON l.id = dl.location_id
      LEFT JOIN units u ON u.id = dl.unit_id
     WHERE it.company_id IN (${sql.raw(c)})
     GROUP BY i.sku, i.name, l.name, u.name
    HAVING sum(it.movement * it.base_quantity) <> 0
     ORDER BY i.name`),

  sales: (c) => documentHeaders(c, "SALES_INVOICE"),
  purchases: (c) => documentHeaders(c, "PURCHASE_INVOICE"),
  sale_lines: (c) => documentLineRows(c, "SALES_INVOICE"),
  purchase_lines: (c) => documentLineRows(c, "PURCHASE_INVOICE"),

  payments: (c) => db.execute(sql`
    SELECT d.number, d.document_date, dt.name AS kind, co.name AS company, ct.display_name AS contact,
           d.grand_total AS amount, ba.account_title AS bank_account, ca.name AS cash_account
      FROM documents d
      JOIN document_types dt ON dt.id = d.document_type_id
      JOIN companies co ON co.id = d.company_id
      LEFT JOIN contacts ct ON ct.id = d.contact_id
      LEFT JOIN bank_accounts ba ON ba.id = d.bank_account_id
      LEFT JOIN cash_accounts ca ON ca.id = d.cash_account_id
     WHERE dt.code IN ('PAYMENT_MADE', 'PAYMENT_RECEIVED') AND d.company_id IN (${sql.raw(c)})
     ORDER BY d.document_date DESC`),

  expenses: (c) => db.execute(sql`
    SELECT e.expense_date, ec.name AS category, co.name AS company, e.amount, e.notes
      FROM expenses e
      JOIN expense_categories ec ON ec.id = e.expense_category_id
      JOIN companies co ON co.id = e.company_id
     WHERE e.company_id IN (${sql.raw(c)}) ORDER BY e.expense_date DESC`),

  ledger: (c) => db.execute(sql`
    SELECT d.document_date, d.number, co.name AS company, ct.display_name AS contact, le.debit, le.credit
      FROM ledger_entries le
      JOIN documents d ON d.id = le.document_id
      JOIN companies co ON co.id = le.company_id
      LEFT JOIN contacts ct ON ct.id = d.contact_id
     WHERE le.company_id IN (${sql.raw(c)}) ORDER BY d.document_date DESC`),
};

function documentHeaders(companies: string, code: string) {
  return db.execute(sql`
    SELECT d.number, d.document_date, co.name AS company, ct.display_name AS contact,
           d.subtotal, d.discount_total, d.tax_total, d.shipping_total, d.grand_total, d.paid_amount, d.is_paid
      FROM documents d
      JOIN document_types dt ON dt.id = d.document_type_id
      JOIN companies co ON co.id = d.company_id
      LEFT JOIN contacts ct ON ct.id = d.contact_id
     WHERE dt.code = ${code} AND d.company_id IN (${sql.raw(companies)})
     ORDER BY d.document_date DESC`);
}

function documentLineRows(companies: string, code: string) {
  return db.execute(sql`
    SELECT d.number, d.document_date, i.sku, i.name AS item, u.name AS unit,
           dl.quantity, dl.unit_price, dl.line_total, coalesce(l.name, 'Unassigned') AS location
      FROM document_lines dl
      JOIN documents d ON d.id = dl.document_id
      JOIN document_types dt ON dt.id = d.document_type_id
      LEFT JOIN items i ON i.id = dl.item_id
      LEFT JOIN units u ON u.id = dl.unit_id
      LEFT JOIN locations l ON l.id = dl.location_id
     WHERE dt.code = ${code} AND d.company_id IN (${sql.raw(companies)})
     ORDER BY d.document_date DESC, dl.line_no`);
}

// Returns rows as plain strings — the browser turns them into a CSV file. Every
// value is stringified here so a numeric column can't arrive as a JS number and
// pick up exponent notation on the way into a spreadsheet.
export async function exportSnapshot(key: string): Promise<{ error?: string; rows?: Record<string, string>[] }> {
  // Exports hand over the whole financial picture, so the gate is read live — a
  // revoked user must not keep downloading it from a stale instance cache.
  const session = await getLiveSession();
  requirePermission(session, "backups", "create");

  const query = QUERIES[key];
  if (!query) return { error: "Unknown export." };

  const ids = await getScopeCompanyIds();
  if (ids.length === 0) return { error: "You don't have access to any company." };
  // Interpolated as literals rather than parameters because it sits inside an
  // IN list built with sql.raw; the ids come from the session, never from input.
  const companyList = ids.map((id) => `'${id}'::uuid`).join(", ");

  const rows = (await query(companyList)) as unknown as Record<string, unknown>[];
  await recordAudit({ action: "import", entity: "data export", summary: `${SNAPSHOT_TABLES.find((t) => t.key === key)?.label ?? key} exported`, detail: `${rows.length} row(s)` });

  return {
    rows: rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v === null || v === undefined ? "" : String(v)]))),
  };
}

// Row counts, so the page can say how big each export is before anyone waits
// for it. One statement for the lot.
export async function snapshotSizes(): Promise<Record<string, number>> {
  const session = await getSession();
  requirePermission(session, "backups", "view");

  const ids = await getScopeCompanyIds();
  if (ids.length === 0) return {};
  const list = sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);

  const [row] = await db.execute<Record<string, number>>(sql`
    SELECT
      (SELECT count(*) FROM items WHERE company_id IN (${list}))::int AS products,
      (SELECT count(*) FROM contacts WHERE company_id IS NULL OR company_id IN (${list}))::int AS contacts,
      (SELECT count(*) FROM documents d JOIN document_types dt ON dt.id = d.document_type_id
         WHERE dt.code = 'SALES_INVOICE' AND d.company_id IN (${list}))::int AS sales,
      (SELECT count(*) FROM documents d JOIN document_types dt ON dt.id = d.document_type_id
         WHERE dt.code = 'PURCHASE_INVOICE' AND d.company_id IN (${list}))::int AS purchases,
      (SELECT count(*) FROM expenses WHERE company_id IN (${list}))::int AS expenses,
      (SELECT count(*) FROM ledger_entries WHERE company_id IN (${list}))::int AS ledger
  `);
  return row ?? {};
}
