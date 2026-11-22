import "server-only";
import { db } from "@/lib/db";
import { documentLines, inventoryTransactions } from "@/lib/db/schema";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type StockWriteRow = { line: typeof documentLines.$inferInsert; movement: 1 | -1; unitCost: number };

// Transfers and adjustments share one posting path: insert all lines, then all
// movements. Callers own authorization, audit, invalidation and the transaction.
export async function writeStockRows(tx: Tx, rows: StockWriteRow[], posted = true) {
  if (!rows.length) return;
  const inserted = await tx.insert(documentLines).values(rows.map((row) => row.line)).returning({ id: documentLines.id });
  const movements = posted ? rows.flatMap((row, index) => row.line.itemId ? [{
    companyId: row.line.companyId,
    documentLineId: inserted[index].id,
    movement: row.movement,
    quantity: row.line.quantity ?? "0",
    baseQuantity: row.line.baseQuantity ?? "0",
    unitCost: String(row.unitCost),
    totalCost: String(row.unitCost * Number(row.line.baseQuantity ?? 0)),
  }] : []) : [];
  if (movements.length) await tx.insert(inventoryTransactions).values(movements);
}
