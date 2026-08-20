import assert from "node:assert/strict";
import { multiplierToBase, priceForUnit, type UnitConversionOption } from "./unit-conversion";

function main() {
  const conversions: UnitConversionOption[] = [
    { itemId: "item-a", fromUnitId: "carton", toUnitId: "piece", multiplier: "24" },
  ];
  assert.equal(multiplierToBase("item-a", "piece", "piece", conversions), 1);
  assert.equal(multiplierToBase("item-a", "carton", "piece", conversions), 24);
  assert.equal(multiplierToBase("item-a", "dozen", "piece", conversions), null, "missing conversions must not invent stock quantities");
  assert.equal(priceForUnit("12.5", 24), "300", "alternate-unit prices derive from the base-unit price");
  assert.equal(priceForUnit("12.5", null), "", "an unavailable conversion cannot display a misleading price");
  console.log("unit-conversion checks passed");
}

main();
