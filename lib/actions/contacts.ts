"use server";

import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { contacts, companies } from "@/lib/db/schema";
import { getSession } from "@/lib/auth/session";
import { requirePermission } from "@/lib/auth/permissions";
import { companyInScope } from "@/lib/auth/scope";
import { CACHE, invalidateLookups } from "@/lib/queries/lookups";
import { guard, DUPLICATE, type ActionResult, type CreateResult } from "@/lib/actions/guard";
import { recordAudit } from "@/lib/actions/audit";

// Contacts are unified — no supplier/customer split. A write is allowed if the
// user can create/edit in either the customers or suppliers module, so both a
// Salesman (customers) and a purchaser (suppliers) can add contacts.
function requireContactPermission(session: Parameters<typeof requirePermission>[0], action: string) {
  try {
    requirePermission(session, "customers", action);
    return;
  } catch {
    // fall through — try suppliers, which throws if that's missing too
  }
  requirePermission(session, "suppliers", action);
}

const contactColumns = {
  id: contacts.id,
  companyId: contacts.companyId,
  displayName: contacts.displayName,
  companyName: contacts.companyName,
  phone: contacts.phone,
  email: contacts.email,
  address: contacts.address,
  city: contacts.city,
  taxNumber: contacts.taxNumber,
  creditLimit: contacts.creditLimit,
  isActive: contacts.isActive,
  company: companies.name,
};

export async function listSuppliers() {
  const session = await getSession();
  requireContactPermission(session, "view");

  // Two queries, run together rather than one after the other. The activity
  // summary is a grouped pass over documents keyed by contact — joining it into
  // the contact list directly would either multiply the contact rows or need a
  // correlated subquery per contact, which is the shape that gets slower with
  // every invoice ever raised.
  const [rows, activity] = await Promise.all([
    db
      .select(contactColumns)
      .from(contacts)
      .leftJoin(companies, eq(contacts.companyId, companies.id))
      .where(await companyInScope(contacts.companyId)),
    db.execute<{ contact_id: string; owes_us: string; we_owe: string; last_document: string | null; documents: number }>(sql`
      SELECT d.contact_id,
             sum(CASE WHEN dt.code = 'SALES_INVOICE' THEN d.grand_total - d.paid_amount ELSE 0 END) AS owes_us,
             sum(CASE WHEN dt.code = 'PURCHASE_INVOICE' THEN d.grand_total - d.paid_amount ELSE 0 END) AS we_owe,
             max(d.document_date)::text AS last_document,
             count(*)::int AS documents
        FROM documents d
        JOIN document_types dt ON dt.id = d.document_type_id
       WHERE d.contact_id IS NOT NULL
         AND dt.code IN ('SALES_INVOICE', 'PURCHASE_INVOICE')
       GROUP BY d.contact_id`),
  ]);

  const byContact = new Map(activity.map((a) => [a.contact_id, a]));
  return rows.map((r) => {
    const a = byContact.get(r.id);
    return {
      ...r,
      owesUs: a?.owes_us ?? "0",
      weOwe: a?.we_owe ?? "0",
      lastDocument: a?.last_document ?? null,
      documentCount: Number(a?.documents ?? 0),
    };
  });
}

export async function getContact(id: string) {
  const session = await getSession();
  requireContactPermission(session, "view");
  const [row] = await db
    .select(contactColumns)
    .from(contacts)
    .leftJoin(companies, eq(contacts.companyId, companies.id))
    .where(eq(contacts.id, id));
  return row ?? null;
}

function readContactForm(formData: FormData) {
  const str = (key: string) => String(formData.get(key) ?? "").trim() || null;
  return {
    displayName: String(formData.get("displayName") ?? "").trim(),
    companyId: str("companyId"),
    companyName: str("companyName"),
    phone: str("phone"),
    email: str("email"),
    address: str("address"),
    city: str("city"),
    taxNumber: str("taxNumber"),
    creditLimit: str("creditLimit") ?? "0",
    isActive: formData.has("isActive") ? formData.get("isActive") === "on" : true,
  };
}

export interface ContactBatchRow {
  displayName: string;
  companyId: string | null;
  companyName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  taxNumber: string | null;
  creditLimit: string;
  isActive: boolean;
}

// Returns the rows it created so a quick-add from inside a sale or payment can
// drop the new contact straight into the field the user was filling in.
export async function createContactsBatch(
  rows: ContactBatchRow[],
): Promise<CreateResult<{ id: string; name: string; companyId: string | null }>> {
  return guard(
    "Couldn't save the contacts.",
    async () => {
      const session = await getSession();
      const valid = rows.filter((r) => r.displayName.trim());
      if (valid.length === 0) return { error: "Add at least one contact with a name." };

      requireContactPermission(session, "create");

      const created = await db
        .insert(contacts)
        .values(valid)
        .returning({ id: contacts.id, name: contacts.displayName, companyId: contacts.companyId });
      invalidateLookups(CACHE.contacts);
      revalidatePath("/purchases/suppliers");
      await recordAudit({ action: "create", entity: "contact", summary: created.map((c) => c.name).slice(0, 5).join(", ") });
      return { created };
    },
    { [DUPLICATE]: "Can't create — one of these contact codes is already in use." },
  );
}

// --- Edit contacts in bulk -------------------------------------------------

// A contact typed into a sale or purchase line is created name-only — that's
// what the red dot on the list marks. Ticking those and opening them together is
// how the missing halves get filled in, one pass instead of one dialog each.
export interface ContactEditRow {
  id: string;
  displayName: string;
  companyId: string | null;
  companyName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  taxNumber: string | null;
  creditLimit: string | null;
  isActive: boolean | null;
}

// Scoped like the list itself, so a ticked id from a stale page can't reach a
// contact outside the user's companies.
export async function getContactsForEdit(ids: string[]): Promise<ContactEditRow[]> {
  const session = await getSession();
  requireContactPermission(session, "view");
  if (ids.length === 0) return [];

  // No join: the grid edits the company *scope* through a picker, so the
  // company's name is of no use here — unlike the list, which displays it.
  const { company, ...editableColumns } = contactColumns;
  void company;
  return db
    .select(editableColumns)
    .from(contacts)
    .where(and(inArray(contacts.id, ids), await companyInScope(contacts.companyId)))
    .orderBy(contacts.displayName);
}

// One statement for the whole batch, not one per row. Twenty ticked contacts
// used to be twenty `UPDATE … WHERE id = $1` inside a transaction — twenty round
// trips to a database ~170ms away, so saving the grid took three and a half
// seconds of pure waiting. `UPDATE … FROM (VALUES …)` is one trip, and atomic
// without needing a transaction wrapped round it.
export async function updateContactsBatch(rows: ContactEditRow[]): Promise<{ error?: string; saved?: number }> {
  return guard(
    "Couldn't save the contacts.",
    async () => {
      const session = await getSession();
      requireContactPermission(session, "edit");

      const blank = rows.findIndex((r) => !r.displayName.trim());
      if (blank !== -1) return { error: `Row ${blank + 1}: a contact needs a name.` };
      if (rows.length === 0) return { error: "Nothing to save." };

      const str = (v: string | null) => {
        const trimmed = (v ?? "").trim();
        return trimmed === "" ? null : trimmed;
      };

      // Every value carries its cast: a VALUES list arrives as untyped
      // parameters, so Postgres has to be told a blank city is a NULL varchar.
      const values = sql.join(
        rows.map(
          (r) => sql`(
            ${r.id}::uuid,
            ${r.displayName.trim()}::varchar,
            ${str(r.companyId)}::uuid,
            ${str(r.companyName)}::varchar,
            ${str(r.phone)}::varchar,
            ${str(r.email)}::varchar,
            ${str(r.address)}::text,
            ${str(r.city)}::varchar,
            ${str(r.taxNumber)}::varchar,
            ${str(r.creditLimit) ?? "0"}::numeric,
            ${r.isActive ?? true}::boolean
          )`,
        ),
        sql`, `,
      );

      await db.execute(sql`
        UPDATE contacts AS c
        SET display_name = v.display_name,
            company_id   = v.company_id,
            company_name = v.company_name,
            phone        = v.phone,
            email        = v.email,
            address      = v.address,
            city         = v.city,
            tax_number   = v.tax_number,
            credit_limit = v.credit_limit,
            is_active    = v.is_active
        FROM (VALUES ${values}) AS v(id, display_name, company_id, company_name, phone, email, address, city, tax_number, credit_limit, is_active)
        WHERE c.id = v.id
      `);

      invalidateLookups(CACHE.contacts);
      revalidatePath("/purchases/suppliers");
      await recordAudit({ action: "update", entity: "contact", summary: `${rows.length} contact(s) edited` });
      return { saved: rows.length };
    },
    { [DUPLICATE]: "Can't save — that contact code is already in use." },
  );
}

export async function updateContact(contactId: string, _prevState: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard("Couldn't save the contact.", async () => {
    const session = await getSession();
    const data = readContactForm(formData);
    requireContactPermission(session, "edit");
    if (!data.displayName) return { error: "Name is required." };

    await db.update(contacts).set(data).where(eq(contacts.id, contactId));
    invalidateLookups(CACHE.contacts);
    revalidatePath("/purchases/suppliers");
    await recordAudit({ action: "update", entity: "contact", entityId: contactId, summary: data.displayName, companyId: data.companyId });
    return { success: true };
  });
}
