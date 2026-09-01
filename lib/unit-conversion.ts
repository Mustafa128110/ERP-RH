export type UnitConversionOption = {
  ruleId?: string;
  itemId: string;
  fromUnitId: string;
  toUnitId: string;
  // One from-unit equals multiplier to-units.
  multiplier: string;
};

export type UnitConversionRule = Omit<UnitConversionOption, "itemId">;

type Edge = { to: string; multiplier: number };

const ruleKey = (rule: UnitConversionRule) =>
  rule.ruleId ?? JSON.stringify([rule.fromUnitId, rule.toUnitId, rule.multiplier]);

// A product is assigned only the first, product-specific step of a packing
// hierarchy. Reusable rules below that step join automatically: assigning
// "sack -> dozen" also picks up "dozen -> pieces". The join follows the rule
// direction deliberately. Otherwise every rule that starts at Sack (nail
// packets, mouse traps, and so on) would become interchangeable merely because
// those products share a container name.
export function expandUnitConversionOptions(
  assignments: UnitConversionOption[],
  rules: UnitConversionRule[],
): UnitConversionOption[] {
  const assignedByItem = new Map<string, UnitConversionOption[]>();
  for (const assignment of assignments) {
    assignedByItem.set(assignment.itemId, [...(assignedByItem.get(assignment.itemId) ?? []), assignment]);
  }

  const expanded: UnitConversionOption[] = [];
  for (const [itemId, seeds] of assignedByItem) {
    const included = new Set(seeds.map(ruleKey));
    const reachable = new Set(seeds.map((rule) => rule.toUnitId));
    expanded.push(...seeds);

    let changed = true;
    while (changed) {
      changed = false;
      for (const rule of rules) {
        const key = ruleKey(rule);
        if (included.has(key) || !reachable.has(rule.fromUnitId)) continue;
        included.add(key);
        reachable.add(rule.toUnitId);
        expanded.push({ ...rule, itemId });
        changed = true;
      }
    }
  }
  return expanded;
}

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
  return String(Math.round(Number(basePrice) * multiplier * 10_000) / 10_000);
}

// Keeps an edited line's price meaningful while its unit changes. A Rs 3,600
// sack at 360 base pieces therefore becomes Rs 120 per dozen (12 base pieces)
// and Rs 10 per piece, even before the item has any sales history.
export function priceBetweenUnits(
  currentPrice: string | null | undefined,
  currentMultiplier: number | null,
  nextMultiplier: number | null,
  fallbackBasePrice?: string | null,
): string {
  if (currentPrice && currentMultiplier !== null && Number.isFinite(currentMultiplier) && currentMultiplier > 0) {
    return priceForUnit(String(Number(currentPrice) / currentMultiplier), nextMultiplier);
  }
  return priceForUnit(fallbackBasePrice, nextMultiplier);
}
