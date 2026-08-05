import type { PaymentDirection } from "@/lib/actions/payments";

// Which side of the ledger a payment books. A payment settles part of a balance,
// so it books the *opposite* side of whatever raised it: a payment made offsets
// a purchase's credit ("We Owe") with a debit, and a payment received offsets a
// sale's debit ("Owes Us") with a credit.
//
// Lives out here because `lib/actions/payments.ts` is `"use server"` and can only
// export async functions — and because getting the side backwards silently
// doubles a balance instead of clearing it, which is worth one check.
export function paymentLedgerSide(direction: PaymentDirection, amount: string) {
  return direction === "made" ? ({ debit: amount } as const) : ({ credit: amount } as const);
}
