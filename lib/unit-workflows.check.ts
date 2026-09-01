import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { directUnitMergeError } from "./unit-merge";

function source(file: string) {
  return fs.readFileSync(path.join(process.cwd(), file), "utf8");
}

function main() {
  assert.equal(directUnitMergeError([]), null, "units without a direct rule may merge");
  assert.equal(directUnitMergeError([{ multiplier: "1" }]), null, "a 1:1 alias rule may merge");
  assert.match(directUnitMergeError([{ multiplier: "12" }]) ?? "", /different quantities/, "dozen and piece must not merge as duplicate units");

  const purchases = source("lib/actions/purchases.ts");
  assert.match(purchases, /resolveBaseQuantities\([\s\S]*?"assume-base"[\s\S]*?\);/, "stock purchases must accept units before a rule/base is configured");

  const purchaseForm = source("components/modules/StockPurchaseForm.tsx");
  assert.match(purchaseForm, /function unitsForLine\([\s\S]*?return unitOpts;/, "stock purchase unit picker must offer every unit");

  const stock = source("lib/actions/stock.ts");
  assert.match(stock, /sum\(\$\{inventoryTransactions\.movement\} \* \$\{inventoryTransactions\.baseQuantity\}\)/, "stock must total persisted base quantity");
  assert.match(stock, /leftJoin\(units, eq\(units\.id, items\.baseUnitId\)\)/, "stock totals must use the product base unit label");

  const unitActions = source("lib/actions/units.ts");
  for (const transfer of [
    /update\(items\)[\s\S]*?baseUnitId: targetUnitId/,
    /update\(documentLines\)[\s\S]*?unitId: targetUnitId/,
    /update\(marketPurchaseRequests\)[\s\S]*?unitId: targetUnitId/,
    /update\(unitConversions\)[\s\S]*?fromUnitId: targetUnitId/,
    /update\(unitConversions\)[\s\S]*?toUnitId: targetUnitId/,
  ]) assert.match(unitActions, transfer, "unit merge must transfer every unit reference before deletion");

  console.log("unit workflow checks passed");
}

main();
