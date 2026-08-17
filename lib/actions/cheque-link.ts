import "server-only";
import { and, eq, isNull, or } from "drizzle-orm";
import { chequeRegister } from "@/lib/db/schema";
import { chequeStatusAfterSettling } from "@/lib/cheque-constants";

// Settling with a cheque is the one settlement that consumes a shared,
// exhaustible resource: the register's cheques are offered unlinked, but the
// offer is a snapshot — the offline cache can still list one another device
// just spent, and cheque_register.document_id carries no unique constraint of
// its own (expenses are protected by their own unique cheque_id, everything
// else needs this guard). Every settlement path — payments, expenses, sales,
// purchases, cash transfers — links through here, so the link write refuses a
// cheque already attached to another document rather than silently re-linking
// it: the WHERE re-checks against the committed row (the UPDATE's row lock
// serialises two racers, so exactly one wins), and a zero-row result aborts
// the whole document. The operation id makes the retry safe — nothing was
// written.
//
// A plain module, not "use server": it runs server-side and is only ever
// called from server actions, so it carries no directive of its own (same
// shape as lib/actions/resolve-refs.ts).
export class ChequeUnavailableError extends Error {
  constructor() {
    super("That cheque is already used on another document — pick a different one or refresh.");
    this.name = "ChequeUnavailableError";
  }
}

type Tx = Parameters<Parameters<typeof import("@/lib/db").db.transaction>[0]>[0];

// direction is the settlement direction ("in" = money received, "out" = money
// paid), which decides the status the cheque lands in — RECEIVED when it came
// to us, ISSUED when it left — matching what the register means by each.
export async function linkCheque(tx: Tx, chequeId: string, documentId: string, direction: "in" | "out") {
  const linked = await tx
    .update(chequeRegister)
    .set({ documentId, status: chequeStatusAfterSettling(direction) })
    .where(and(eq(chequeRegister.id, chequeId), or(isNull(chequeRegister.documentId), eq(chequeRegister.documentId, documentId))))
    .returning({ id: chequeRegister.id });
  if (linked.length === 0) throw new ChequeUnavailableError();
}
