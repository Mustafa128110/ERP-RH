import assert from "node:assert/strict";

import { fifoLayerValue } from "./stock-cost";

assert.equal(
  fifoLayerValue([{ quantity: 20, unitCost: 10 }, { quantity: 30, unitCost: 5 }], 0),
  350,
  "stock value retains every purchase layer instead of applying one recent rate",
);
assert.equal(
  fifoLayerValue([{ quantity: 20, unitCost: 10 }, { quantity: 30, unitCost: 5 }], 20),
  150,
  "FIFO issues consume the oldest purchase layer first",
);
assert.equal(fifoLayerValue([{ quantity: 20, unitCost: 10 }], 30), 0, "negative stock has no invented value");
console.log("stock-cost FIFO checks passed");
