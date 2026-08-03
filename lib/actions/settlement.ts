import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { bankAccounts, cashAccounts, chequeRegister } from "@/lib/db/schema";

// Not "use server". This module's one export takes a live transaction handle,
// which can't cross an HTTP boundary — the directive published it as an endpoint
// anyway. The option lists that used to sit alongside it moved to
// lib/queries/lookups.ts.

export type SettlementType = "account" | "cash" | "cheque";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// direction "out": money leaves the company (debit the account) — expenses,
// paid purchases, payments made. direction "in": money enters — payments
// received. Cheques settle indirectly through the bank account they're
// drawn on/deposited to.
export async function adjustSettlementBalance(
  tx: Tx,
  direction: "in" | "out",
  amount: string,
  bankAccountId: string | null,
  cashAccountId: string | null,
  chequeId: string | null,
  sign: 1 | -1,
) {
  const delta = String((direction === "out" ? -1 : 1) * sign * Number(amount));
  if (bankAccountId) {
    await tx.update(bankAccounts).set({ currentBalance: sql`${bankAccounts.currentBalance} + ${delta}` }).where(eq(bankAccounts.id, bankAccountId));
  } else if (cashAccountId) {
    await tx.update(cashAccounts).set({ currentBalance: sql`${cashAccounts.currentBalance} + ${delta}` }).where(eq(cashAccounts.id, cashAccountId));
  } else if (chequeId) {
    // Resolving the cheque's bank account in a subquery rather than a separate
    // SELECT keeps this to one statement. Every statement inside a transaction
    // is its own ~170ms round trip, and this runs on the create, update and
    // delete path of payments, purchases, sales and expenses alike. A cheque
    // with no bank account matches no rows, which is the same no-op the
    // explicit null check produced.
    await tx
      .update(bankAccounts)
      .set({ currentBalance: sql`${bankAccounts.currentBalance} + ${delta}` })
      .where(
        eq(
          bankAccounts.id,
          sql`(select ${chequeRegister.bankAccountId} from ${chequeRegister} where ${chequeRegister.id} = ${chequeId})`,
        ),
      );
  }
}
