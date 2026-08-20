import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "./index";
import { numberSequences } from "./schema";

// Every sequential number in the app comes from here.
//
// The allocation is one statement on purpose. "Read the current value, add one,
// write it back" is three steps, and two requests can interleave between the
// read and the write — which is exactly how two invoices end up numbered
// SI-0007. INSERT .. ON CONFLICT DO UPDATE .. RETURNING does the increment
// inside the database, which serialises concurrent callers on the row lock and
// hands each a distinct value.
//
// Takes an optional transaction so a number can be allocated inside the same
// transaction that writes the row using it — if that transaction rolls back the
// counter rolls back with it, and the number is reissued rather than skipped.

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Db = typeof db | Tx;

export async function nextSequenceValue(scope: string, tx: Db = db): Promise<number> {
  const [row] = await tx
    .insert(numberSequences)
    .values({ scope, nextValue: 2 })
    .onConflictDoUpdate({
      target: numberSequences.scope,
      set: { nextValue: sql`${numberSequences.nextValue} + 1` },
    })
    .returning({ allocated: sql<number>`${numberSequences.nextValue} - 1` });

  return Number(row.allocated);
}

// Reserve a contiguous block in the same single atomic statement. Batch grids
// must not turn N blank SKUs into N network round trips inside one transaction.
export async function nextSequenceRange(scope: string, count: number, tx: Db = db): Promise<number[]> {
  if (count <= 0) return [];
  const [row] = await tx
    .insert(numberSequences)
    .values({ scope, nextValue: count + 1 })
    .onConflictDoUpdate({
      target: numberSequences.scope,
      set: { nextValue: sql`${numberSequences.nextValue} + ${count}` },
    })
    .returning({ first: sql<number>`${numberSequences.nextValue} - ${count}` });
  const first = Number(row.first);
  return Array.from({ length: count }, (_, index) => first + index);
}

// Read-only, and deliberately not a reservation: it powers the SKU the product
// form shows before you submit. Nothing is consumed, so opening a form and
// closing it doesn't burn a number, and two people opening the form at once
// both see the same preview. The real number is allocated on save.
export async function peekSequenceValue(scope: string): Promise<number> {
  const [row] = await db
    .select({ next: numberSequences.nextValue })
    .from(numberSequences)
    .where(eq(numberSequences.scope, scope))
    .limit(1);
  return row?.next ?? 1;
}

export const SKU_SCOPE = "sku";
export const SKU_PREFIX = "RH";
export const SKU_PAD = 5;

export function formatSku(value: number) {
  return `${SKU_PREFIX}-${String(value).padStart(SKU_PAD, "0")}`;
}

// One counter per document series, shared by every company — Royal Hardware and
// M52 draw SI numbers from the same run, so the series is continuous instead of
// each company restarting at SI-0001.
//
// Keyed by series rather than document_type_id because document_types rows are
// per company: the two companies' SALES_INVOICE are different ids for the same
// 'SI' series, which is what made the numbering split in the first place.
export function documentScope(series: string) {
  return `doc:${series}`;
}
