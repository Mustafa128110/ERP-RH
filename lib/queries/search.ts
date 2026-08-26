import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { PER_KIND, type SearchKind } from "@/lib/search-constants";

// The SQL behind the top bar's search box. It lives here rather than in
// lib/actions/search.ts for the reason lib/queries/reports.ts does: it takes an
// already-resolved scope, so it can be run — and therefore checked — without a
// session (lib/queries/search.check.ts). The action above it is what turns a
// cookie into the scope and the two permission flags this takes.
//
// One statement, not one per kind. Seventeen separate queries would be
// seventeen round trips to a database ~170ms away on every debounce tick, which
// is the difference between a list that keeps up with typing and one that lags
// a word behind. A UNION ALL of seventeen small LIMITed selects is one trip.

export type SearchRow = { kind: string; id: string; title: string; subtitle: string | null };

// One branch per document code, built from a list rather than written out five
// times — they differ only in the code and in what the hit is called.
const DOCUMENT_KINDS: { kind: SearchKind; code: string }[] = [
  { kind: "invoice", code: "SALES_INVOICE" },
  { kind: "purchase", code: "PURCHASE_INVOICE" },
  { kind: "quotation", code: "QUOTATION" },
  { kind: "transfer", code: "STOCK_TRANSFER" },
  { kind: "adjustment", code: "STOCK_ADJUSTMENT" },
];

export type SearchGrants = {
  // Users and roles are not scoped by company at all, so company scope is no
  // protection for them. Without these, a salesman could type a colleague's
  // name into the top bar and get their email address back.
  users: boolean;
  roles: boolean;
};

export async function searchRows(companyIds: string[], term: string, grants: SearchGrants, onlyKind?: SearchKind): Promise<SearchRow[]> {
  if (companyIds.length === 0) return [];

  const companies = sql.join(
    companyIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );

  // ILIKE with a leading wildcard can't use a btree index, so each branch is
  // capped at PER_KIND and every scoped branch is confined to the company
  // scope — bounded work regardless of how common the term is.
  const pattern = `%${term.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;

  const wants = (kind: SearchKind) => !onlyKind || onlyKind === kind;
  const parts: SQL[] = [
    ...(wants("product") ? [sql`(SELECT 'product' AS kind, i.id::text AS id, i.name AS title, i.sku AS subtitle
           FROM items i
          WHERE i.company_id IN (${companies}) AND (i.name ILIKE ${pattern} OR i.sku ILIKE ${pattern})
          ORDER BY i.name LIMIT ${PER_KIND})`] : []),
    ...(wants("contact") ? [sql`(SELECT 'contact', c.id::text, c.display_name, coalesce(c.phone, c.company_name, c.city)
           FROM contacts c
          WHERE (c.company_id IS NULL OR c.company_id IN (${companies}))
            AND (c.display_name ILIKE ${pattern} OR c.phone ILIKE ${pattern} OR c.company_name ILIKE ${pattern})
          ORDER BY c.display_name LIMIT ${PER_KIND})`] : []),
    // The kind is written into the SQL text rather than passed as a parameter:
    // an untyped parameter in a SELECT list leaves Postgres unable to infer the
    // column's type across a UNION. It comes from the constant list above, not
    // from anything a user typed.
    ...DOCUMENT_KINDS.filter(({ kind }) => wants(kind)).map(
      ({ kind, code }) => sql`
      (SELECT ${sql.raw(`'${kind}'`)}, d.id::text, d.number, coalesce(ct.display_name, '') || ' · ' || d.grand_total
         FROM documents d
         JOIN document_types dt ON dt.id = d.document_type_id
         LEFT JOIN contacts ct ON ct.id = d.contact_id
        WHERE d.company_id IN (${companies}) AND dt.code = ${code}
          AND (d.number ILIKE ${pattern} OR ct.display_name ILIKE ${pattern})
        ORDER BY d.document_date DESC LIMIT ${PER_KIND})`,
    ),
    // Payments are two document codes under one kind — nobody searching for a
    // payment cares which direction it went until they can see it.
    ...(wants("payment") ? [sql`(SELECT 'payment', d.id::text, d.number, coalesce(ct.display_name, '') || ' · ' || d.grand_total
           FROM documents d
           JOIN document_types dt ON dt.id = d.document_type_id
           LEFT JOIN contacts ct ON ct.id = d.contact_id
          WHERE d.company_id IN (${companies}) AND dt.code IN ('PAYMENT_RECEIVED', 'PAYMENT_MADE')
            AND (d.number ILIKE ${pattern} OR ct.display_name ILIKE ${pattern})
          ORDER BY d.document_date DESC LIMIT ${PER_KIND})`] : []),
    // Expenses aren't part of the documents model, so they carry their own
    // branch. Matched on the note and the category, which is all an expense is
    // named by.
    ...(wants("expense") ? [sql`(SELECT 'expense', e.id::text, coalesce(nullif(e.notes, ''), ec.name), ec.name || ' · ' || e.amount
           FROM expenses e
           JOIN expense_categories ec ON ec.id = e.expense_category_id
          WHERE e.company_id IN (${companies})
            AND (e.notes ILIKE ${pattern} OR ec.name ILIKE ${pattern})
          ORDER BY e.expense_date DESC LIMIT ${PER_KIND})`] : []),
    // Master data. These tables are global — no company_id to scope by, because
    // a brand is a brand everywhere (lib/db/schema.ts).
    ...(wants("category") ? [sql`(SELECT 'category', c.id::text, c.name, '' FROM categories c
          WHERE c.name ILIKE ${pattern} ORDER BY c.name LIMIT ${PER_KIND})`] : []),
    ...(wants("brand") ? [sql`(SELECT 'brand', b.id::text, b.name, '' FROM brands b
          WHERE b.name ILIKE ${pattern} ORDER BY b.name LIMIT ${PER_KIND})`] : []),
    ...(wants("unit") ? [sql`(SELECT 'unit', u.id::text, u.name, coalesce(u.symbol, '') FROM units u
          WHERE u.name ILIKE ${pattern} OR u.symbol ILIKE ${pattern} ORDER BY u.name LIMIT ${PER_KIND})`] : []),
    ...(wants("location") ? [sql`(SELECT 'location', l.id::text, l.name, l.location_type::text FROM locations l
          WHERE l.name ILIKE ${pattern} OR l.code ILIKE ${pattern} ORDER BY l.name LIMIT ${PER_KIND})`] : []),
    ...(wants("tax") ? [sql`(SELECT 'tax', t.id::text, t.name, t.rate::text || '%' FROM taxes t
          WHERE t.name ILIKE ${pattern} ORDER BY t.name LIMIT ${PER_KIND})`] : []),
    // Only the companies this person can act in — which other companies exist
    // is not something the search box should hand out.
    ...(wants("company") ? [sql`(SELECT 'company', co.id::text, co.name, coalesce(co.short_name, '') FROM companies co
          WHERE co.id IN (${companies}) AND co.name ILIKE ${pattern} ORDER BY co.name LIMIT ${PER_KIND})`] : []),
  ];

  if (grants.users && wants("user")) {
    parts.push(
      sql`(SELECT 'user', us.id::text, us.name, us.email FROM users us
            WHERE us.name ILIKE ${pattern} OR us.email ILIKE ${pattern}
            ORDER BY us.name LIMIT ${PER_KIND})`,
    );
  }
  if (grants.roles && wants("role")) {
    parts.push(
      sql`(SELECT 'role', r.id::text, r.name, '' FROM roles r
            WHERE r.name ILIKE ${pattern} ORDER BY r.name LIMIT ${PER_KIND})`,
    );
  }

  if (parts.length === 0) return [];
  // A scoped search can leave any branch as the first SELECT. Name the union's
  // four columns here instead of relying on the product branch to do it; that
  // branch is absent for unit:, contact:, and every other narrowed search.
  return db.execute<SearchRow>(sql`
    SELECT kind, id, title, subtitle
    FROM (${sql.join(parts, sql` UNION ALL `)}) AS hits(kind, id, title, subtitle)
  `);
}
