import assert from "node:assert/strict";
import {
  isValidIsoDate,
  SETTING_DEFS,
  STOCK_COLUMN_SETTINGS,
  stockColumnVisibilityFromSettings,
} from "./setting-constants";

assert.equal(isValidIsoDate("2026-08-26"), true);
assert.equal(isValidIsoDate("2024-02-29"), true, "a leap day is a real date");
assert.equal(isValidIsoDate("2026-02-29"), false);
assert.equal(isValidIsoDate("2026-13-01"), false);
assert.equal(isValidIsoDate("2026-08-32"), false);
assert.equal(isValidIsoDate("26-08-26"), false);

assert.deepEqual(
  STOCK_COLUMN_SETTINGS.map((col) => col.columnKey),
  ["setup", "baseQuantity", "unitRules", "rate3"],
  "all four Stock columns must be configurable in settings",
);
for (const col of STOCK_COLUMN_SETTINGS) {
  const def = SETTING_DEFS.find((entry) => entry.key === col.settingKey);
  assert.ok(def, `missing SETTING_DEFS entry for ${col.settingKey}`);
  assert.equal(def.kind, "boolean");
  assert.equal(def.fallback, "true");
}
assert.deepEqual(stockColumnVisibilityFromSettings({}), {
  setup: true,
  baseQuantity: true,
  unitRules: true,
  rate3: true,
});
assert.deepEqual(
  stockColumnVisibilityFromSettings({
    show_stock_setup_column: "false",
    show_stock_base_quantity_column: "true",
    show_stock_unit_rules_column: "false",
    show_stock_purchase_rate_3_column: "false",
  }),
  {
    setup: false,
    baseQuantity: true,
    unitRules: false,
    rate3: false,
  },
);
console.log("setting constants checks passed");
