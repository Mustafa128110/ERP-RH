export type UnitConversionOption = {
  itemId: string;
  fromUnitId: string;
  toUnitId: string;
  // One from-unit equals multiplier to-units.
  multiplier: string;
};

type Edge = { to: string; multiplier: number };

// Finds a multiplier through the product's rule graph. Every entered rule is
// usable in both directions: "1 dozen = 12 pieces" also means "1 piece = 1/12
// dozen". A breadth-first search makes chained rules work too (carton -> dozen
// -> piece) without storing redundant reverse rows.
export function multiplierBetweenUnits(
  itemId: string,
  fromUnitId: string,
  toUnitId: string | null | undefined,
  conversions: UnitConversionOption[],
): number | null {
  if (!fromUnitId || !toUnitId) return null;
  if (fromUnitId === toUnitId) return 1;

  const graph = new Map<string, Edge[]>();
  const add = (from: string, to: string, multiplier: number) => {
    if (!Number.isFinite(multiplier) || multiplier <= 0) return;
    graph.set(from, [...(graph.get(from) ?? []), { to, multiplier }]);
  };
  for (const rule of conversions) {
    if (rule.itemId !== itemId) continue;
    const multiplier = Number(rule.multiplier);
    add(rule.fromUnitId, rule.toUnitId, multiplier);
    add(rule.toUnitId, rule.fromUnitId, 1 / multiplier);
  }

  const queue: { unitId: string; multiplier: number }[] = [{ unitId: fromUnitId, multiplier: 1 }];
  const seen = new Set<string>([fromUnitId]);
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const current = queue[cursor];
    for (const edge of graph.get(current.unitId) ?? []) {
      const next = current.multiplier * edge.multiplier;
      if (edge.to === toUnitId) return next;
      if (!seen.has(edge.to)) {
        seen.add(edge.to);
        queue.push({ unitId: edge.to, multiplier: next });
      }
    }
  }
  return null;
}

export function multiplierToBase(
  itemId: string,
  unitId: string,
  baseUnitId: string | null | undefined,
  conversions: UnitConversionOption[],
): number | null {
  if (!baseUnitId) return unitId ? 1 : null;
  return multiplierBetweenUnits(itemId, unitId, baseUnitId, conversions);
}

// The sales picker may offer only the base stock unit plus units attached to a
// rule for that product. An unconfigured product deliberately returns no unit:
// the sale remains valid as a provisional, unitless line rather than letting a
// user select an unrelated global unit.
export function unitIdsForProduct(
  itemId: string,
  baseUnitId: string | null | undefined,
  conversions: UnitConversionOption[],
): string[] {
  const ids = new Set<string>();
  if (baseUnitId) ids.add(baseUnitId);
  for (const rule of conversions) {
    if (rule.itemId !== itemId) continue;
    ids.add(rule.fromUnitId);
    ids.add(rule.toUnitId);
  }
  return [...ids];
}

export function priceForUnit(basePrice: string | null | undefined, multiplier: number | null): string {
  if (!basePrice || multiplier === null || !Number.isFinite(multiplier)) return "";
  return String(Math.round(Number(basePrice) * multiplier * 10) / 10);
}
