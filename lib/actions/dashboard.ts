"use server";

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  bankAccounts,
  cashAccounts,
  companies,
  documentLines,
  documentTypes,
  documents,
  expenses,
  inventoryTransactions,
  items,
  locations,
  units,
} from "@/lib/db/schema";
import { getSession } from "@/lib/auth/session";
import { requirePermission } from "@/lib/auth/permissions";
import { companyInScope } from "@/lib/auth/scope";

// Every number on the dashboard is derived here, in SQL, from the same rows the
// list pages read. Nothing is stored as a running total, so a figure can't drift
// from the documents behind it.
//
// The business runs on one clock, and `documents.document_date` is a DATE written
// from the browser's local day. Asking the server for "today" would return the
// UTC day, which at UTC+5 flips five hours early — an evening sale would land on
// tomorrow's card.
const BUSINESS_TIMEZONE = "Asia/Karachi";

function businessToday() {
  return new Date().toLocaleDateString("en-CA", { timeZone: BUSINESS_TIMEZONE });
}

export interface DashboardData {
  today: string;
  todaySales: number;
  todayPurchases: number;
  todayExpenses: number;
  cashPosition: number;
  receivables: number;
  payables: number;
  inventoryValue: number;
  outOfStock: number;
  topProducts: { name: string; unitsSold: number; unit: string }[];
  warehouses: { name: string; value: number; outOfStock: number }[];
}

export async function getDashboardData(): Promise<DashboardData> {
  const session = await getSession();
  // No `dashboard` module in the permission catalog. sales.view is the broadest
  // read anyone who reaches this page already holds; every query below is still
  // company-scoped, so it never shows books the user can't otherwise open.
  requirePermission(session, "sales", "view");

  const today = businessToday();
  const documentScope = await companyInScope(documents.companyId);

  // One pass over documents for the four money figures — four separate scans of
  // the same table would cost four round trips for numbers that share a filter.
  // greatest(...,0) keeps an overpaid invoice from subtracting from what's owed.
  const isSale = sql`${documentTypes.code} = 'SALES_INVOICE'`;
  const isPurchase = sql`${documentTypes.code} = 'PURCHASE_INVOICE'`;
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
      .where(and(inArray(documentTypes.code, ["SALES_INVOICE", "PURCHASE_INVOICE"]), documentScope)),

    db
      .select({ total: sql<string>`coalesce(sum(${expenses.amount}), 0)` })
      .from(expenses)
      .where(and(eq(expenses.expenseDate, today), await companyInScope(expenses.companyId))),

    db
      .select({ total: sql<string>`coalesce(sum(${bankAccounts.currentBalance}), 0)` })
      .from(bankAccounts)
      .where(and(eq(bankAccounts.isActive, true), await companyInScope(bankAccounts.companyId))),

    db
      .select({ total: sql<string>`coalesce(sum(${cashAccounts.currentBalance}), 0)` })
      .from(cashAccounts)
      .where(and(eq(cashAccounts.isActive, true), await companyInScope(cashAccounts.companyId))),

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
      .where(await companyInScope(items.companyId))
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
      .where(and(eq(documentTypes.code, "SALES_INVOICE"), documentScope))
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

// Named separately from the numbers above because it's the one thing on the page
// that isn't an aggregate — used for the header line.
export async function getDashboardCompanies() {
  const session = await getSession();
  requirePermission(session, "sales", "view");
  return db.select({ name: companies.name }).from(companies).where(await companyInScope(companies.id));
}
