import assert from "node:assert/strict";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { documentLines, inventoryTransactions } from "@/lib/db/schema";
import { fifoValuations } from "@/lib/queries/stock-cost";

async function main() {
  const [sample] = await db
    .select({ itemId: documentLines.itemId, locationId: documentLines.locationId })
    .from(inventoryTransactions)
    .innerJoin(documentLines, eq(documentLines.id, inventoryTransactions.documentLineId))
    .limit(1);
  const itemId = sample?.itemId;
  if (!itemId) {
    console.log("stock-cost FIFO database check skipped: no inventory movements");
    return;
  }
  const [value] = await fifoValuations([{ itemId, locationId: sample.locationId }]);
  assert.ok(Number.isFinite(value), "FIFO valuation must return a finite amount for a stored stock location");
  console.log("stock-cost FIFO database query passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
