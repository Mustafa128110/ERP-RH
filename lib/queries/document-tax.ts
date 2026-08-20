import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { items, taxes } from "@/lib/db/schema";
import { companySettingValue } from "@/lib/queries/settings";
import { calculateTax } from "@/lib/tax-calculation";

export class TaxConfigurationError extends Error {
  constructor(message = "The selected tax is no longer active.") {
    super(message);
    this.name = "TaxConfigurationError";
  }
}

export async function resolveDocumentTax(
  companyId: string,
  taxId: string | null,
  lines: { itemId: string | null; lineTotal: number }[],
  discountTotal: number,
  shippingTotal: number,
) {
  const itemIds = [...new Set(lines.map((line) => line.itemId).filter((id): id is string => Boolean(id)))];
  const [taxRows, itemRows, inclusiveValue] = await Promise.all([
    taxId ? db.select({ id: taxes.id, rate: taxes.rate }).from(taxes).where(and(eq(taxes.id, taxId), eq(taxes.isActive, true))).limit(1) : Promise.resolve([]),
    itemIds.length ? db.select({ id: items.id, taxable: items.taxable }).from(items).where(inArray(items.id, itemIds)) : Promise.resolve([]),
    companySettingValue(companyId, "tax_prices_include_tax"),
  ]);
  if (taxId && !taxRows[0]) throw new TaxConfigurationError();
  const taxableByItem = new Map(itemRows.map((item) => [item.id, item.taxable ?? false]));
  const rate = Number(taxRows[0]?.rate ?? 0);
  const inclusive = inclusiveValue === "true";
  const calculation = calculateTax(
    lines.map((line) => ({ lineTotal: line.lineTotal, taxable: line.itemId ? (taxableByItem.get(line.itemId) ?? false) : false })),
    discountTotal,
    shippingTotal,
    rate,
    inclusive,
  );
  return {
    taxId: taxRows[0]?.id ?? null,
    taxRate: rate,
    taxInclusive: inclusive,
    taxable: lines.map((line) => (line.itemId ? (taxableByItem.get(line.itemId) ?? false) : false)),
    ...calculation,
  };
}
