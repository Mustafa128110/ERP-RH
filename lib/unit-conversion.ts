export type UnitConversionOption = {
  itemId: string;
  fromUnitId: string;
  toUnitId: string;
  multiplier: string;
};

export function multiplierToBase(
  itemId: string,
  unitId: string,
  baseUnitId: string | null | undefined,
  conversions: UnitConversionOption[],
): number | null {
  if (!unitId || !baseUnitId || unitId === baseUnitId) return 1;
  const conversion = conversions.find(
    (entry) => entry.itemId === itemId && entry.fromUnitId === unitId && entry.toUnitId === baseUnitId,
  );
  return conversion ? Number(conversion.multiplier) : null;
}

export function priceForUnit(basePrice: string | null | undefined, multiplier: number | null): string {
  if (!basePrice || multiplier === null || !Number.isFinite(multiplier)) return "";
  return String(Math.round(Number(basePrice) * multiplier * 10) / 10);
}

