// Client-safe return arithmetic. A full invoice returned once copies its exact
// header totals, including the last rounding cent. Every partial return (and a
// final instalment after an earlier partial return) is calculated only from the
// quantity being returned now, so it cannot credit the original invoice twice.
export function salesReturnHeaderTotals(input: {
  sourceSubtotal: number;
  sourceDiscount: number;
  sourceTax: number;
  sourceShipping: number;
  sourceGrandTotal: number;
  selectedSubtotal: number;
  selectedTax: number;
  hasPriorReturns: boolean;
  returnsEverySourceLineNow: boolean;
  round: (value: number) => number;
}) {
  const exact = !input.hasPriorReturns && input.returnsEverySourceLineNow;
  const ratio = input.sourceSubtotal > 0 ? input.selectedSubtotal / input.sourceSubtotal : 0;
  const discount = exact ? input.sourceDiscount : input.round(input.sourceDiscount * ratio);
  const shipping = exact ? input.sourceShipping : input.round(input.sourceShipping * ratio);
  const tax = exact ? input.sourceTax : input.round(input.selectedTax);
  const grandTotal = exact ? input.sourceGrandTotal : input.round(input.selectedSubtotal - discount + tax + shipping);
  return { discount, shipping, tax, grandTotal, exact };
}
