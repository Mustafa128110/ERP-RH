export type TaxableLine = { lineTotal: number; taxable: boolean };

export type TaxCalculation = {
  taxTotal: number;
  grandTotal: number;
  lineTaxAmounts: number[];
};

const money2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

// Discount is shared proportionally across every line. Tax is then calculated
// only on taxable products. In inclusive mode it is extracted from the entered
// amount; in exclusive mode it is added to the invoice total.
export function calculateTax(
  lines: TaxableLine[],
  discountTotal: number,
  shippingTotal: number,
  rate: number,
  inclusive: boolean,
): TaxCalculation {
  const subtotal = money2(lines.reduce((sum, line) => sum + line.lineTotal, 0));
  const safeDiscount = Math.min(Math.max(discountTotal, 0), subtotal);
  const discountFactor = subtotal > 0 ? (subtotal - safeDiscount) / subtotal : 0;
  const taxableBases = lines.map((line) => (line.taxable ? line.lineTotal * discountFactor : 0));
  const rawTaxes = taxableBases.map((base) =>
    rate <= 0 ? 0 : inclusive ? (base * rate) / (100 + rate) : (base * rate) / 100,
  );
  const taxTotal = money2(rawTaxes.reduce((sum, amount) => sum + amount, 0));
  const rounded = rawTaxes.map(money2);
  const roundingDifference = money2(taxTotal - rounded.reduce((sum, amount) => sum + amount, 0));
  const lastTaxable = taxableBases.findLastIndex((base) => base > 0);
  if (lastTaxable >= 0) rounded[lastTaxable] = money2(rounded[lastTaxable] + roundingDifference);
  return {
    taxTotal,
    grandTotal: money2(subtotal - safeDiscount + shippingTotal + (inclusive ? 0 : taxTotal)),
    lineTaxAmounts: rounded,
  };
}

