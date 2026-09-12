import { and, desc, eq, inArray, isNull, or, sql, type Column, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { bankAccounts, cashAccounts, documentLines, documentTypes, documents, expenses, inventoryTransactions, items, locations, units } from "@/lib/db/schema";
import type { DashboardData } from "@/lib/actions/dashboard";
function idsInScope(column: Column, ids: string[], includeGlobal = false): SQL {
  if (ids.length === 0) return includeGlobal ? isNull(column) : sql`false`;
  return (includeGlobal ? or(isNull(column), inArray(column, ids)) : inArray(column, ids))!;
}
export async function loadDashboard(
  today: string,
  scopes: { sales: string[]; purchases: string[]; expenses: string[]; accounts: string[]; stock: string[] },
): Promise<DashboardData> {
  const saleScope = idsInScope(documents.companyId, scopes.sales);
  const purchaseScope = idsInScope(documents.companyId, scopes.purchases);

  // One pass over documents for the four money figures — four separate scans of
  // the same table would cost four round trips for numbers that share a filter.
  // greatest(...,0) keeps an overpaid invoice from subtracting from what's owed.
  const isSale = and(sql`${documentTypes.code} = 'SALES_INVOICE'`, eq(documents.status, "posted"), saleScope)!;
  const isPurchase = and(sql`${documentTypes.code} = 'PURCHASE_INVOICE'`, eq(documents.status, "posted"), purchaseScope)!;
  const isToday = sql`${documents.documentDate} = ${today}`;
  const stillOwed = sql`greatest(${documents.grandTotal} - ${documents.paidAmount}, 0)`;

  const [
    [money],
    [expenseToday],
    [bank],
    [cash],
    stockRows,
    topRows,
  ] = await Promise.all([
    db
      .select({
        todaySales: sql<string>`coalesce(sum(case when ${isSale} and ${isToday} then ${documents.grandTotal} else 0 end), 0)`,
        todayPurchases: sql<string>`coalesce(sum(case when ${isPurchase} and ${isToday} then ${documents.grandTotal} else 0 end), 0)`,
        receivables: sql<string>`coalesce(sum(case when ${isSale} then ${stillOwed} else 0 end), 0)`,
        payables: sql<string>`coalesce(sum(case when ${isPurchase} then ${stillOwed} else 0 end), 0)`,
      })
      .from(documents)
      .innerJoin(documentTypes, eq(documentTypes.id, documents.documentTypeId))
      .where(or(isSale, isPurchase)),

    db
      .select({ total: sql<string>`coalesce(sum(${expenses.amount}), 0)` })
      .from(expenses)
      .where(and(eq(expenses.expenseDate, today), eq(expenses.status, "posted"), idsInScope(expenses.companyId, scopes.expenses))),

    db
      .select({ total: sql<string>`coalesce(sum(${bankAccounts.currentBalance}), 0)` })
      .from(bankAccounts)
      .where(and(eq(bankAccounts.isActive, true), idsInScope(bankAccounts.companyId, scopes.accounts, true))),

    db
      .select({ total: sql<string>`coalesce(sum(${cashAccounts.currentBalance}), 0)` })
      .from(cashAccounts)
      .where(and(eq(cashAccounts.isActive, true), idsInScope(cashAccounts.companyId, scopes.accounts))),

    // On-hand is derived (SUM of signed movements) and so is cost: the average of
    // what came in. Grouped per item and location so the same rows answer the
    // total valuation, the per-warehouse split, and what has run out.
    db
      .select({
        itemId: items.id,
        location: sql<string>`coalesce(${locations.name}, 'Unassigned')`,
        onHand: sql<string>`sum(${inventoryTransactions.movement} * ${inventoryTransactions.baseQuantity})`,
        costSum: sql<string>`sum(case when ${inventoryTransactions.movement} = 1 then ${inventoryTransactions.totalCost} else 0 end)`,
        costQty: sql<string>`sum(case when ${inventoryTransactions.movement} = 1 then ${inventoryTransactions.baseQuantity} else 0 end)`,
      })
      .from(inventoryTransactions)
      .innerJoin(documentLines, eq(documentLines.id, inventoryTransactions.documentLineId))
      .innerJoin(items, eq(items.id, documentLines.itemId))
      .leftJoin(locations, eq(locations.id, documentLines.locationId))
      .where(idsInScope(items.companyId, scopes.stock))
      .groupBy(items.id, locations.name),

    // What actually moved off the shelves, by quantity sold.
    db
      .select({
        name: items.name,
        unit: sql<string>`coalesce(max(${units.symbol}), '')`,
        unitsSold: sql<string>`sum(${documentLines.baseQuantity})`,
      })
      .from(documentLines)
      .innerJoin(documents, eq(documents.id, documentLines.documentId))
      .innerJoin(documentTypes, eq(documentTypes.id, documents.documentTypeId))
      .innerJoin(items, eq(items.id, documentLines.itemId))
      .leftJoin(units, eq(units.id, documentLines.unitId))
      .where(isSale)
      .groupBy(items.name)
      .orderBy(desc(sql`sum(${documentLines.baseQuantity})`))
      .limit(5),
  ]);

  // Valuation is per item *per location* — the average cost differs by where the
  // stock came in, and a warehouse total has to use its own.
  const byLocation = new Map<string, { value: number; outOfStock: number }>();
  const onHandByItem = new Map<string, number>();
  let inventoryValue = 0;

  for (const r of stockRows) {
    const onHand = Number(r.onHand);
    const costQty = Number(r.costQty);
    const value = costQty > 0 ? onHand * (Number(r.costSum) / costQty) : 0;

    onHandByItem.set(r.itemId, (onHandByItem.get(r.itemId) ?? 0) + onHand);
    inventoryValue += value;

    const entry = byLocation.get(r.location) ?? { value: 0, outOfStock: 0 };
    entry.value += value;
    if (onHand <= 0) entry.outOfStock += 1;
    byLocation.set(r.location, entry);
  }

  return {
    today,
    todaySales: Number(money.todaySales),
    todayPurchases: Number(money.todayPurchases),
    todayExpenses: Number(expenseToday.total),
    cashPosition: Number(bank.total) + Number(cash.total),
    receivables: Number(money.receivables),
    payables: Number(money.payables),
    inventoryValue,
    // Counted per item, not per item-location: something sitting in one warehouse
    // and gone from another has not run out.
    outOfStock: [...onHandByItem.values()].filter((q) => q <= 0).length,
    topProducts: topRows.map((r) => ({ name: r.name, unitsSold: Number(r.unitsSold), unit: r.unit })),
    warehouses: [...byLocation.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.value - a.value),
  };
}
