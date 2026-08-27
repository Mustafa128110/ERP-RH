// Sales and stock-purchase grids deal in quantities, so their compact unit
// picker shows the printed symbol (pcs, doz, kg) rather than repeating the
// long master-data name. A legacy/name-only unit still has a usable fallback
// until its setup is completed with a symbol.
export function unitPickerLabel(unit: { name: string; symbol: string | null }): string {
  return unit.symbol?.trim() || unit.name;
}
