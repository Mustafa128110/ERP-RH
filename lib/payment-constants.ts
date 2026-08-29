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

// What the ledger holds for one contact in one company. This is the exact same
// sign as the individual statement's closing balance: debit - credit. Positive
// is a receivable ("Owes Us"), negative a payable ("We Owe").
export type ContactBalanceHint = { contactId: string; companyId: string; balance: number };

// Which company a payment belongs in.
//
// A contact with no company of its own is visible in every company, so the
// company box on a payment row is a free choice — and it defaulted to the first
// company in the list. Take money off a customer whose invoices are M52 while
// the row says Royal Hardware and the receipt is real, the cash is real, and the
// receivable it was meant to settle sits in the other set of books untouched:
// the "Owes Us" figure simply doesn't move, which is what it looked like from
// the ledger page.
//
// So: the company where this contact's balance is on the side the payment
// settles. Receiving settles a receivable (balance > 0), paying settles a
// payable (balance < 0). Only when exactly one company qualifies — a contact who
// is a customer of one company and a supplier of the other is both, and which
// one is being settled is a real decision that stays with the person making it.
export function settlingCompanyId(balances: ContactBalanceHint[], contactId: string, direction: PaymentDirection): string | null {
  const owing = balances.filter((b) => b.contactId === contactId && (direction === "received" ? b.balance > 0 : b.balance < 0));
  return owing.length === 1 ? owing[0].companyId : null;
}
