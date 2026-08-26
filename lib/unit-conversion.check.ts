import assert from "node:assert/strict";
import { multiplierBetweenUnits, multiplierToBase, priceForUnit, unitIdsForProduct, type UnitConversionOption } from "./unit-conversion";

function main() {
  const conversions: UnitConversionOption[] = [
    { itemId: "item-a", fromUnitId: "carton", toUnitId: "dozen", multiplier: "2" },
    { itemId: "item-a", fromUnitId: "dozen", toUnitId: "piece", multiplier: "12" },
  ];
  assert.equal(multiplierToBase("item-a", "piece", "piece", conversions), 1);
  assert.equal(multiplierToBase("item-a", "carton", "piece", conversions), 24, "rules may chain to the base unit");
  assert.equal(multiplierBetweenUnits("item-a", "piece", "dozen", conversions), 1 / 12, "a rule works backwards too");
  assert.deepEqual(unitIdsForProduct("item-a", "piece", conversions).sort(), ["carton", "dozen", "piece"], "only the base unit and this product's rule units are allowed");
  assert.deepEqual(unitIdsForProduct("unconfigured", null, conversions), [], "an unconfigured product stays unitless instead of offering unrelated units");
  assert.equal(multiplierToBase("item-a", "bag", "piece", conversions), null, "missing conversions must not invent stock quantities");
  assert.equal(priceForUnit("12.5", 24), "300", "alternate-unit prices derive from the base-unit price");
  assert.equal(priceForUnit("12.5", null), "", "an unavailable conversion cannot display a misleading price");
  console.log("unit-conversion checks passed");
}

main();
