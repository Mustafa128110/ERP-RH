import assert from "node:assert/strict";
import {
  expandUnitConversionOptions,
  multiplierBetweenUnits,
  multiplierToBase,
  priceBetweenUnits,
  priceForUnit,
  unitIdsForProduct,
  type UnitConversionOption,
  type UnitConversionRule,
} from "./unit-conversion";

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
  assert.equal(priceBetweenUnits("3600", 360, 12), "120", "an entered sack price converts to a dozen price");
  assert.equal(priceBetweenUnits("120", 12, 1), "10", "an entered dozen price converts to a piece price");

  const rules: UnitConversionRule[] = [
    { ruleId: "sack-dozen", fromUnitId: "sack", toUnitId: "dozen", multiplier: "30" },
    { ruleId: "dozen-piece", fromUnitId: "dozen", toUnitId: "piece", multiplier: "12" },
    { ruleId: "sack-nail-packet", fromUnitId: "sack", toUnitId: "nail-packet", multiplier: "50" },
  ];
  const expanded = expandUnitConversionOptions(
    [{ ...rules[0], itemId: "mouse-trap" }],
    rules,
  );
  assert.equal(multiplierToBase("mouse-trap", "sack", "piece", expanded), 360, "reusable downstream rules join without a direct sack-to-piece rule");
  assert.deepEqual(unitIdsForProduct("mouse-trap", "piece", expanded).sort(), ["dozen", "piece", "sack"], "a sibling rule starting from sack is not inherited by an unrelated product");
  console.log("unit-conversion checks passed");
}

main();
