"use server";

import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { PermissionError } from "@/lib/auth/permissions";
import { getScopeCompanyIds } from "@/lib/auth/scope";

// What the box in the top bar searches. It was a plain <input> that did nothing
// at all — the one control on every screen, wired to nothing.
//
// One statement, not one per kind. Four separate queries would be four round
// trips to a database ~170ms away on every debounce tick, which is the
// difference between a list that keeps up with typing and one that lags a word
// behind. A UNION ALL of four small LIMITed selects is a single trip.

export type SearchHit = {
  kind: "product" | "contact" | "invoice" | "purchase";
  id: string;
  title: string;
  subtitle: string;
  href: string;
};

// Per kind, not overall: five of each beats twenty products and nothing else.
const PER_KIND = 5;

type Raw = { kind: string; id: string; title: string; subtitle: string | null };

export async function globalSearch(query: string): Promise<SearchHit[]> {
  const session = await getSession();
  if (!session) throw new PermissionError("Not authenticated");

  const q = query.trim();
  // One character matches most of the catalogue — that's a table scan rendered
  // as a dropdown, not a search.
  if (q.length < 2) return [];

  const scope = await getScopeCompanyIds();
  if (scope.length === 0) return [];
  const companies = sql.join(
    scope.map((id) => sql`${id}::uuid`),
    sql`, `,
  );

  // ILIKE with a leading wildcard can't use a btree index, so each branch is
  // capped at PER_KIND and the whole thing runs against the company scope —
  // bounded work regardless of how common the term is.
  const pattern = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;

  const rows = await db.execute<Raw>(sql`
    (SELECT 'product' AS kind, i.id::text AS id, i.name AS title, i.sku AS subtitle
       FROM items i
      WHERE i.company_id IN (${companies}) AND (i.name ILIKE ${pattern} OR i.sku ILIKE ${pattern})
      ORDER BY i.name LIMIT ${PER_KIND})
    UNION ALL
    (SELECT 'contact', c.id::text, c.display_name, coalesce(c.phone, c.company_name, c.city)
       FROM contacts c
      WHERE (c.company_id IS NULL OR c.company_id IN (${companies}))
        AND (c.display_name ILIKE ${pattern} OR c.phone ILIKE ${pattern} OR c.company_name ILIKE ${pattern})
      ORDER BY c.display_name LIMIT ${PER_KIND})
    UNION ALL
    (SELECT 'invoice', d.id::text, d.number, coalesce(ct.display_name, '') || ' · ' || d.grand_total
       FROM documents d
       JOIN document_types dt ON dt.id = d.document_type_id
       LEFT JOIN contacts ct ON ct.id = d.contact_id
      WHERE d.company_id IN (${companies}) AND dt.code = 'SALES_INVOICE'
        AND (d.number ILIKE ${pattern} OR ct.display_name ILIKE ${pattern})
      ORDER BY d.document_date DESC LIMIT ${PER_KIND})
    UNION ALL
    (SELECT 'purchase', d.id::text, d.number, coalesce(ct.display_name, '') || ' · ' || d.grand_total
       FROM documents d
       JOIN document_types dt ON dt.id = d.document_type_id
       LEFT JOIN contacts ct ON ct.id = d.contact_id
      WHERE d.company_id IN (${companies}) AND dt.code = 'PURCHASE_INVOICE'
        AND (d.number ILIKE ${pattern} OR ct.display_name ILIKE ${pattern})
      ORDER BY d.document_date DESC LIMIT ${PER_KIND})
  `);

  // Where each kind of hit goes when it's chosen. Products and contacts have no
  // detail page of their own — both are edited from their list — so they land on
  // the list, which now has a search box of its own to finish the job.
  const href: Record<string, (id: string) => string> = {
    product: () => "/inventory/products",
    contact: () => "/purchases/suppliers",
    invoice: (id) => `/sales/invoices/${id}`,
    purchase: () => "/purchases/stock",
  };

  return rows.map((r) => ({
    kind: r.kind as SearchHit["kind"],
    id: r.id,
    title: r.title,
    subtitle: r.subtitle ?? "",
    href: href[r.kind](r.id),
  }));
}
