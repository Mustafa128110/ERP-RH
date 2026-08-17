"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { companies, userCompanyAccess } from "@/lib/db/schema";
import { getLiveSession, getSession } from "@/lib/auth/session";
import { requirePermission } from "@/lib/auth/permissions";
import { CACHE, invalidateLookups } from "@/lib/queries/lookups";
import { guard, type ActionResult } from "@/lib/actions/guard";
import { recordAudit } from "@/lib/actions/audit";

export async function listCompanies() {
  const session = await getSession();
  requirePermission(session, "companies", "view");
  return db.select().from(companies);
}

export async function getCompany(companyId: string) {
  const session = await getSession();
  requirePermission(session, "companies", "view");
  const [company] = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
  return company ?? null;
}

function readCompanyForm(formData: FormData) {
  return {
    name: String(formData.get("name") ?? "").trim(),
    shortName: String(formData.get("shortName") ?? "").trim() || null,
    phone: String(formData.get("phone") ?? "").trim() || null,
    email: String(formData.get("email") ?? "").trim() || null,
    taxNumber: String(formData.get("taxNumber") ?? "").trim() || null,
    address: String(formData.get("address") ?? "").trim() || null,
  };
}

export interface CompanyBatchRow {
  name: string;
  shortName: string | null;
  phone: string | null;
  email: string | null;
  taxNumber: string | null;
  address: string | null;
}

export async function createCompaniesBatch(rows: CompanyBatchRow[]): Promise<ActionResult> {
  return guard("Couldn't save the companies.", async () => {
    const session = await getLiveSession();
    requirePermission(session, "companies", "create");

    const valid = rows.filter((r) => r.name.trim());
    if (valid.length === 0) return { error: "Add at least one company with a name." };

    // One transaction, because this is two writes that have to agree: a company
    // row, and the creating admin's access to it. Split across two statements
    // (which is how this was written), a failure on the second left a company
    // nobody could see or select — invisible in every dropdown, and undeletable
    // through the UI that couldn't list it.
    await db.transaction(async (tx) => {
      const created = await tx.insert(companies).values(valid).returning({ id: companies.id });
      await tx
        .insert(userCompanyAccess)
        .values(created.map((c) => ({ userId: session.userId, companyId: c.id })))
        .onConflictDoNothing();
    });

    invalidateLookups(CACHE.companies);
    // The new company changes what the Topbar scope selector offers, and that
    // lives in the dashboard layout rather than on this page.
    revalidatePath("/", "layout");
    await recordAudit({ action: "create", entity: "company", summary: valid.map((r) => r.name).join(", ") });
    return { success: true };
  });
}

export async function updateCompany(companyId: string, _prevState: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard("Couldn't save the company.", async () => {
    const session = await getLiveSession();
    requirePermission(session, "companies", "edit");

    const values = readCompanyForm(formData);
    if (!values.name) return { error: "Name is required." };

    await db.update(companies).set(values).where(eq(companies.id, companyId));
    invalidateLookups(CACHE.companies);
    revalidatePath("/", "layout");
    await recordAudit({ action: "update", entity: "company", entityId: companyId, summary: values.name, companyId });
    return { success: true };
  });
}

export async function deleteCompany(_prevState: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard("Can't delete — other records (contacts, items, documents, …) still reference this company.", async () => {
    const session = await getLiveSession();
    requirePermission(session, "companies", "delete");

    const companyId = String(formData.get("companyId") ?? "");
    await db.delete(companies).where(eq(companies.id, companyId));

    invalidateLookups(CACHE.companies);
    revalidatePath("/", "layout");
    await recordAudit({ action: "delete", entity: "company", entityId: companyId, summary: companyId });
    return { success: true };
  });
}
