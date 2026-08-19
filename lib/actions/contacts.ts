"use server";

import { and, eq, inArray, or, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { contacts, companies } from "@/lib/db/schema";
import { getLiveSession, getSession } from "@/lib/auth/session";
import { requirePermission } from "@/lib/auth/permissions";
import { companyInPermissionScope, companyInScope, getScopeCompanyIds } from "@/lib/auth/scope";
import { CACHE, invalidateLookups } from "@/lib/queries/lookups";
import { guard, DUPLICATE, type ActionResult, type CreateResult } from "@/lib/actions/guard";
import { recordAudit } from "@/lib/actions/audit";
import type { AuthSession } from "@/lib/auth/session";

// Contacts are unified — no supplier/customer split. A write is allowed if the
// user can create/edit in either the customers or suppliers module, so both a
// Salesman (customers) and a purchaser (suppliers) can add contacts.
function requireContactPermission(session: AuthSession | null, action: string, companyId?: string): asserts session is AuthSession {
  const scope = companyId ? { companyId } : undefined;
  try {
    requirePermission(session, "customers", action, scope);
    return;
  } catch {
    // fall through — try suppliers, which throws if that's missing too
  }
  requirePermission(session, "suppliers", action, scope);
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

export async function listContacts() {
  const session = await getSession();
  requireContactPermission(session, "view");
  const scopeIds = await getScopeCompanyIds();
  const permittedIds = scopeIds.filter((companyId) =>
    ["customers.view", "suppliers.view"].some(
      (key) => session.globalPermissions.has(key) || session.permissionsByCompany.get(companyId)?.has(key),
    ),
  );
  const documentScope = permittedIds.length > 0
    ? sql`d.company_id IN (${sql.join(permittedIds.map((id) => sql`${id}::uuid`), sql`, `)})`
    : sql`false`;

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
      .where(
        or(
          await companyInPermissionScope(contacts.companyId, session, "customers"),
          await companyInPermissionScope(contacts.companyId, session, "suppliers"),
        ),
      ),
    // The two balances come off ledger_entries, the same rows the Ledger screen
    // reads, so a contact's figure here and there is one number arrived at once.
    // Summing (grand_total - paid_amount) over the invoices instead — which is
    // what this did — misses every payment taken on the Payments screen, because
    // a standalone payment is its own document and never writes back to the
    // invoice's paid_amount. A customer who had settled in full still showed the
    // whole original balance under "Owes Us".
    //
    // A contact has one running account, so the net is split by sign rather than
    // by document type: they owe us, or we owe them, never both at once.
    // last_document and the count still speak for the invoices only — that's the
    // trading history, and a payment is not a document anyone means by it.
    db.execute<{ contact_id: string; owes_us: string; we_owe: string; last_document: string | null; documents: number }>(sql`
      SELECT d.contact_id,
             greatest(coalesce(sum(l.debit - l.credit), 0), 0) AS owes_us,
             greatest(coalesce(sum(l.credit - l.debit), 0), 0) AS we_owe,
             (max(d.document_date) FILTER (WHERE dt.code IN ('SALES_INVOICE', 'PURCHASE_INVOICE')))::text AS last_document,
             count(DISTINCT d.id) FILTER (WHERE dt.code IN ('SALES_INVOICE', 'PURCHASE_INVOICE'))::int AS documents
        FROM documents d
        JOIN document_types dt ON dt.id = d.document_type_id
        LEFT JOIN ledger_entries l ON l.document_id = d.id
       WHERE d.contact_id IS NOT NULL
         AND ${documentScope}
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
    .where(
      and(
        eq(contacts.id, id),
        or(
          await companyInPermissionScope(contacts.companyId, session, "customers"),
          await companyInPermissionScope(contacts.companyId, session, "suppliers"),
        ),
      ),
    );
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
      const session = await getLiveSession();
      const valid = rows.filter((r) => r.displayName.trim());
      if (valid.length === 0) return { error: "Add at least one contact with a name." };

      requireContactPermission(session, "create");
      // Every company the batch files under must be one the user belongs to and
      // can create contacts in — a row carrying a forged or stale companyId is
      // refused rather than silently filed there.
      for (const companyId of new Set(valid.map((r) => r.companyId).filter((c): c is string => !!c))) {
        requireContactPermission(session, "create", companyId);
      }

      const created = await db
        .insert(contacts)
        .values(valid)
        .returning({ id: contacts.id, name: contacts.displayName, companyId: contacts.companyId });
      invalidateLookups(CACHE.contacts);
      revalidatePath("/purchases/suppliers");
      revalidatePath("/contacts");
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
      const session = await getLiveSession();
      requireContactPermission(session, "edit");
      // Every company the batch moves rows into must be one the user can act
      // on; the UPDATE below is also scoped, so an out-of-scope row never matches.
      for (const companyId of new Set(rows.map((r) => r.companyId).filter((c): c is string => !!c))) {
        requireContactPermission(session, "edit", companyId);
      }

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

      // The scope rides on the existing row's company, so a ticked id from a
      // stale page can't reach a contact outside the user's companies.
      const scope = await companyInScope(contacts.companyId);
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
        WHERE c.id = v.id AND ${scope}
      `);

      invalidateLookups(CACHE.contacts);
      revalidatePath("/purchases/suppliers");
      revalidatePath("/contacts");
      await recordAudit({ action: "update", entity: "contact", summary: `${rows.length} contact(s) edited` });
      return { saved: rows.length };
    },
    { [DUPLICATE]: "Can't save — that contact code is already in use." },
  );
}

export async function updateContact(contactId: string, _prevState: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard("Couldn't save the contact.", async () => {
    const session = await getLiveSession();
    const data = readContactForm(formData);
    requireContactPermission(session, "edit");
    // A non-global company in the submission must be one the user can act on.
    if (data.companyId) requireContactPermission(session, "edit", data.companyId);
    if (!data.displayName) return { error: "Name is required." };

    // Scoped so a guessed id can't reach a contact outside the user's companies.
    await db.update(contacts).set(data).where(and(eq(contacts.id, contactId), await companyInScope(contacts.companyId)));
    invalidateLookups(CACHE.contacts);
    revalidatePath("/purchases/suppliers");
    revalidatePath("/contacts");
    await recordAudit({ action: "update", entity: "contact", entityId: contactId, summary: data.displayName, companyId: data.companyId });
    return { success: true };
  });
}
