export const CHEQUE_TYPES = ["ACCOUNT_PAYEE", "BEARER", "CROSS", "OPEN", "POST_DATED"] as const;
export const CHEQUE_STATUSES = ["RECEIVED", "ISSUED", "IN_HAND", "DEPOSITED", "CLEARED", "RETURNED", "CANCELLED", "VOID"] as const;

export type ChequeStatus = (typeof CHEQUE_STATUSES)[number];

// What settling with a cheque does to it.
//
// Money in: the cheque is now ours to hold — RECEIVED. Money out: it has left,
// whether it was ours to begin with or a customer's passed along — ISSUED. Undo
// the payment and it goes back to IN_HAND, which is what the register means by
// "here, unspoken for".
//
// Statuses, not deletions: the payment still points at the cheque that settled
// it, and "where did cheque 44215 go" stays answerable.
export const UNSPENT_CHEQUE_STATUS = "IN_HAND" satisfies ChequeStatus;

export function chequeStatusAfterSettling(direction: "in" | "out"): ChequeStatus {
  return direction === "out" ? "ISSUED" : "RECEIVED";
}

// Spent: done with, and off the register's working list. What's left — in hand,
// received, deposited, or returned and needing chasing — is what someone
// actually has to act on.
export const SPENT_CHEQUE_STATUSES: readonly ChequeStatus[] = ["ISSUED", "CLEARED", "CANCELLED", "VOID"];

export const isChequeSpent = (status: string) => SPENT_CHEQUE_STATUSES.includes(status as ChequeStatus);
