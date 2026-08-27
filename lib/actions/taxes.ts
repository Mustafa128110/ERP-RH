"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { taxes } from "@/lib/db/schema";
import { getLiveSession, getSession } from "@/lib/auth/session";
import { requireGlobalPermission } from "@/lib/auth/permissions";
import { guard, type ActionResult } from "@/lib/actions/guard";
import { recordAudit } from "@/lib/actions/audit";
import { CACHE, invalidateLookups } from "@/lib/queries/lookups";
import { parseTaxRate } from "@/lib/tax-rate";

export async function listTaxes() {
  const session = await getSession();
  requireGlobalPermission(session, "taxes", "view");
  return db.select().from(taxes);
}

export async function getTax(taxId: string) {
  const session = await getSession();
  requireGlobalPermission(session, "taxes", "view");
  const [row] = await db.select().from(taxes).where(eq(taxes.id, taxId)).limit(1);
  return row ?? null;
}

function readTaxForm(formData: FormData) {
  return {
    name: String(formData.get("name") ?? "").trim(),
    rate: String(formData.get("rate") ?? "").trim(),
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
    const session = await getLiveSession();
    requireGlobalPermission(session, "taxes", "create");

    const entered = rows.filter((row) => row.name.trim());
    if (entered.length === 0) return { error: "Add at least one tax with a name and rate." };

    const valid: TaxBatchRow[] = [];
    for (const [index, row] of entered.entries()) {
      const parsed = parseTaxRate(row.rate);
      if ("error" in parsed) return { error: `Row ${index + 1}: ${parsed.error}` };
      valid.push({ name: row.name.trim(), rate: parsed.value, isActive: Boolean(row.isActive) });
    }

    await db.insert(taxes).values(valid);
    await invalidateLookups(CACHE.taxes);
    revalidatePath("/taxes");
    await recordAudit({ action: "create", entity: "tax", summary: valid.map((r) => r.name).join(", ") });
    return { success: true };
  });
}

export async function updateTax(taxId: string, _prevState: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard("Couldn't save the tax.", async () => {
    const session = await getLiveSession();
    requireGlobalPermission(session, "taxes", "edit");

    const values = readTaxForm(formData);
    if (!values.name) return { error: "Name is required." };
    const parsedRate = parseTaxRate(values.rate);
    if ("error" in parsedRate) return { error: parsedRate.error };
    values.rate = parsedRate.value;

    await db.update(taxes).set(values).where(eq(taxes.id, taxId));
    await invalidateLookups(CACHE.taxes);
    revalidatePath("/taxes");
    await recordAudit({ action: "update", entity: "tax", entityId: taxId, summary: values.name, detail: `Rate ${values.rate}%` });
    return { success: true };
  });
}

export async function deleteTax(_prevState: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard("Couldn't delete the tax.", async () => {
    const session = await getLiveSession();
    requireGlobalPermission(session, "taxes", "delete");

    const taxId = String(formData.get("taxId") ?? "");
    await db.delete(taxes).where(eq(taxes.id, taxId));
    await invalidateLookups(CACHE.taxes);

    revalidatePath("/taxes");
    await recordAudit({ action: "delete", entity: "tax", entityId: taxId, summary: taxId });
    return { success: true };
  });
}
