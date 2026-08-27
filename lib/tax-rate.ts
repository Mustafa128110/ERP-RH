export const MIN_TAX_RATE = 0;
export const MAX_TAX_RATE = 100;

export type TaxRateResult = { value: string; error?: never } | { value?: never; error: string };

// A tax percentage changes every document total that uses it. Keep its parsing
// in one shared, runtime-safe function: browser number inputs are advisory and
// Server Actions can be called with arbitrary serialized values.
export function parseTaxRate(input: unknown): TaxRateResult {
  const value = String(input ?? "").trim();
  if (!value) return { error: "Rate is required." };

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return { error: "Rate must be a finite number." };
  if (numeric < MIN_TAX_RATE || numeric > MAX_TAX_RATE) {
    return { error: `Rate must be between ${MIN_TAX_RATE}% and ${MAX_TAX_RATE}%.` };
  }

  return { value };
}
