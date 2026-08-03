"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { taxes } from "@/lib/db/schema";
import { getSession } from "@/lib/auth/session";
import { requirePermission } from "@/lib/auth/permissions";
import { guard, type ActionResult } from "@/lib/actions/guard";
import { recordAudit } from "@/lib/actions/audit";

export async function listTaxes() {
  const session = await getSession();
  requirePermission(session, "taxes", "view");
  return db.select().from(taxes);
}

export async function getTax(taxId: string) {
  const session = await getSession();
  requirePermission(session, "taxes", "view");
  const [row] = await db.select().from(taxes).where(eq(taxes.id, taxId)).limit(1);
  return row ?? null;
}

function readTaxForm(formData: FormData) {
  return {
    name: String(formData.get("name") ?? "").trim(),
    rate: String(formData.get("rate") ?? "0"),
    isActive: formData.get("isActive") === "on",
  };
}

export interface TaxBatchRow {
  name: string;
  rate: string;
  isActive: boolean;
}

export async function createTaxesBatch(rows: TaxBatchRow[]): Promise<ActionResult> {
  return guard("Couldn't save the taxes.", async () => {
    const session = await getSession();
    requirePermission(session, "taxes", "create");

    const valid = rows.filter((r) => r.name.trim() && !Number.isNaN(Number(r.rate)));
    if (valid.length === 0) return { error: "Add at least one tax with a name and a numeric rate." };

    await db.insert(taxes).values(valid);
    revalidatePath("/taxes");
    await recordAudit({ action: "create", entity: "tax", summary: valid.map((r) => r.name).join(", ") });
    return { success: true };
  });
}

export async function updateTax(taxId: string, _prevState: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard("Couldn't save the tax.", async () => {
    const session = await getSession();
    requirePermission(session, "taxes", "edit");

    const values = readTaxForm(formData);
    if (!values.name) return { error: "Name is required." };
    if (Number.isNaN(Number(values.rate))) return { error: "Rate must be a number." };

    await db.update(taxes).set(values).where(eq(taxes.id, taxId));
    revalidatePath("/taxes");
    await recordAudit({ action: "update", entity: "tax", entityId: taxId, summary: values.name, detail: `Rate ${values.rate}%` });
    return { success: true };
  });
}

export async function deleteTax(_prevState: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard("Can't delete — this tax is still referenced by document lines.", async () => {
    const session = await getSession();
    requirePermission(session, "taxes", "delete");

    const taxId = String(formData.get("taxId") ?? "");
    await db.delete(taxes).where(eq(taxes.id, taxId));

    revalidatePath("/taxes");
    await recordAudit({ action: "delete", entity: "tax", entityId: taxId, summary: taxId });
    return { success: true };
  });
}
