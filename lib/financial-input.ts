export interface FinancialLineInput {
  quantity: unknown;
  unitPrice: unknown;
  unitCost?: unknown;
}

export interface FinancialAdjustmentInput {
  label: string;
  value: unknown;
}

function finiteNonNegative(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0;
}

/**
 * Server-side validation for values that eventually reach numeric columns and
 * account/stock balances. Browser number inputs are only a convenience: a
 * crafted Server Action request can still submit Infinity, NaN or negatives.
 */
export function financialDocumentError(
  lines: FinancialLineInput[],
  adjustments: FinancialAdjustmentInput[],
  options: { allowZeroQuantity?: boolean } = {},
) {
  for (const [index, line] of lines.entries()) {
    const quantity = Number(line.quantity);
    if (!Number.isFinite(quantity) || quantity < 0 || (!options.allowZeroQuantity && quantity === 0)) {
      return `Line ${index + 1}: quantity must be ${options.allowZeroQuantity ? "zero or greater" : "greater than zero"}.`;
    }
    if (!finiteNonNegative(line.unitPrice)) return `Line ${index + 1}: unit price must be zero or greater.`;
    if (line.unitCost != null && String(line.unitCost).trim() !== "" && !finiteNonNegative(line.unitCost)) {
      return `Line ${index + 1}: unit cost must be zero or greater.`;
    }
  }

  for (const adjustment of adjustments) {
    if (!finiteNonNegative(adjustment.value)) return `${adjustment.label} must be zero or greater.`;
  }

  const subtotal = lines.reduce((sum, line) => sum + Number(line.quantity) * Number(line.unitPrice), 0);
  const discount = Number(adjustments.find((adjustment) => adjustment.label === "Discount")?.value ?? 0);
  const additions = adjustments
    .filter((adjustment) => adjustment.label !== "Discount")
    .reduce((sum, adjustment) => sum + Number(adjustment.value), 0);
  if (!Number.isFinite(subtotal + additions - discount)) return "Document total is too large.";
  if (discount > subtotal + additions) return "Discount can't exceed the document total.";
  return null;
}
