// Pure ledger logic — no database, no session, no "use server".
//
// `lib/actions/ledger.ts` is a "use server" module and may only export async
// functions, so the constants, type guards and the FIFO settlement engine live
// here (same split as lib/sale-constants.ts, lib/report-constants.ts).
//
// The engine below is the *definition* of settlement for this app. It is
// deliberately mirrored by a single set-based SQL statement in
// lib/actions/payment-allocation.ts, which is what actually writes: a loop of
// statements inside a transaction is one round trip per row (see AGENTS.md).
// This version exists because two things need FIFO without writing:
//
//   1. the confirmation dialogs, which must say which invoices and payments an
//      edit or a delete is about to disturb — before it happens;
//   2. lib/ledger-flow.check.ts, which pins the behaviour offline.
//
// Both walk the same queues in the same order, so a change to one shows up as a
// failing check rather than as a statement that disagrees with its own preview.

// ---------------------------------------------------------------------------
// Entry kinds
// ---------------------------------------------------------------------------

// The six things that feed one party's ledger. Opening balance is first because
// it is always the oldest item on the account.
export const LEDGER_ENTRY_TYPES = [
  "opening_balance",
  "item_sold",
  "item_bought",
  "payment_received",
  "payment_made",
  "journal_entry",
] as const;

export type LedgerEntryType = (typeof LEDGER_ENTRY_TYPES)[number];

export const LEDGER_TYPE_LABELS: Record<LedgerEntryType, string> = {
  opening_balance: "Opening Balance",
  item_sold: "Item Sold",
  item_bought: "Item Bought",
  payment_received: "Payment Received",
  payment_made: "Payment Made",
  // JOURNAL_ENTRY is retained as an internal legacy document code (cash
  // transfers also use it), but a contact-linked row is an opening-balance
  // posting in the party ledger and is named accordingly.
  journal_entry: "Opening Balance",
};

// document_type_code -> the entry kind the statement shows. MARKET_PURCHASE
// reads as "item_bought" because that is what it is to the party; it differs
// only in that it settles through an expense rather than through the payables
// queue. The legacy JOURNAL_ENTRY code maps to the internal journal_entry kind,
// whose user-facing name is Opening Balance and whose FIFO side comes from its
// debit/credit row.
export function codeToLedgerType(code: string): LedgerEntryType {
  switch (code) {
    case "OPENING_BALANCE": return "opening_balance";
    case "SALES_INVOICE": return "item_sold";
    case "PURCHASE_INVOICE":
    case "MARKET_PURCHASE": return "item_bought";
    case "PAYMENT_RECEIVED": return "payment_received";
    case "PAYMENT_MADE": return "payment_made";
    default: return "journal_entry";
  }
}

// The two independent queues. "receivable" is what the party owes us (sales,
// and a positive opening balance); "payable" is what we owe them (purchases,
// and a negative opening balance).
export type QueueSide = "receivable" | "payable";

// Which queue a payment settles against. A receipt can only ever reduce a
// receivable; a payment out can only ever reduce a payable. There is no manual
// reassignment — the spec is explicit that matching is automatic FIFO by date.
export function paymentQueueSide(direction: "received" | "made"): QueueSide {
  return direction === "received" ? "receivable" : "payable";
}

// Which queue a signed opening balance joins. Positive means the party owes us,
// which is the same side of the account as a sales invoice.
//
// Zero joins neither: there is nothing to settle, and seeding a zero-value item
// into a FIFO queue would hand it allocations of 0, which the
// payment_allocations amount > 0 check rejects.
export function openingQueueSide(signedOpening: number): QueueSide | null {
  if (signedOpening > 0) return "receivable";
  if (signedOpening < 0) return "payable";
  return null;
}

// Document type codes with a fixed settlement side. A contact-linked legacy
// JOURNAL_ENTRY is also settleable, but its side comes from its ledger row and
// therefore cannot live in this fixed map. MARKET_PURCHASE is deliberately
// absent: it settles through its own expense.
export const SETTLEABLE_CODES = {
  SALES_INVOICE: "receivable",
  PURCHASE_INVOICE: "payable",
} as const satisfies Record<string, QueueSide>;

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

// Every amount in the engine is integer paisa. Allocating in floats means a
// 100,000 invoice paid by three receipts of 33,333.34 lands a hundredth short
// of settled and stays "partially paid" forever.
export const toPaisa = (amount: number): number => Math.round(amount * 100);
export const fromPaisa = (paisa: number): number => Math.round(paisa) / 100;

// ---------------------------------------------------------------------------
// FIFO settlement
// ---------------------------------------------------------------------------

// One thing a payment can settle: an invoice, or the opening balance.
export type SettleableItem = {
  id: string;
  side: QueueSide;
  // Gross value of the item, positive. For an invoice this is the grand total,
  // not the unpaid remainder — the remainder is what this engine computes.
  amount: number;
  date: string;
  // Tiebreak within a date. The SQL orders by (document_date, created_at, id)
  // and so does this.
  createdAt: string;
  // The opening balance sorts ahead of every invoice regardless of its date:
  // "it is treated as the oldest item in this queue".
  isOpening?: boolean;
};

export type SettlingPayment = {
  id: string;
  side: QueueSide;
  amount: number;
  date: string;
  createdAt: string;
};

export type FifoAllocation = {
  paymentId: string;
  itemId: string;
  amount: number;
};

export type FifoOutcome = {
  allocations: FifoAllocation[];
  // itemId -> how much of it is settled. Absent means nothing was allocated.
  settledByItem: Map<string, number>;
  // paymentId -> how much of it found an item to settle.
  appliedByPayment: Map<string, number>;
  // Money with nowhere to go yet, per queue. An overpayment is not rejected and
  // not a dangling figure — it waits for the next invoice on that side.
  advance: Record<QueueSide, number>;
};

// The opening balance always leads, then oldest date, then insertion order.
function compareSettleable(a: SettleableItem, b: SettleableItem): number {
  if (Boolean(a.isOpening) !== Boolean(b.isOpening)) return a.isOpening ? -1 : 1;
  return a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

function comparePayment(a: SettlingPayment, b: SettlingPayment): number {
  return a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

// Runs both queues and returns who settled what.
//
// The two sides never interact: a receipt cannot pay down a purchase invoice,
// because that would net two separate obligations against each other and lose
// the fact that both exist. They share one running balance (the statement's
// Balance column) but not one settlement queue.
export function settleFifo(items: readonly SettleableItem[], payments: readonly SettlingPayment[]): FifoOutcome {
  const allocations: FifoAllocation[] = [];
  const settledByItem = new Map<string, number>();
  const appliedByPayment = new Map<string, number>();
  const advance: Record<QueueSide, number> = { receivable: 0, payable: 0 };

  for (const side of ["receivable", "payable"] as const) {
    const queue = items
      .filter((i) => i.side === side && toPaisa(i.amount) > 0)
      .slice()
      .sort(compareSettleable)
      .map((i) => ({ id: i.id, remaining: toPaisa(i.amount) }));

    const incoming = payments
      .filter((p) => p.side === side && toPaisa(p.amount) > 0)
      .slice()
      .sort(comparePayment);

    let cursor = 0;
    for (const payment of incoming) {
      let left = toPaisa(payment.amount);
      let applied = 0;

      // Oldest outstanding item first, splitting across as many as it takes —
      // this is what makes one receipt cover three invoices, and three receipts
      // cover one invoice, without either being a special case.
      while (left > 0 && cursor < queue.length) {
        const item = queue[cursor];
        if (item.remaining <= 0) {
          cursor += 1;
          continue;
        }
        const taken = Math.min(left, item.remaining);
        item.remaining -= taken;
        left -= taken;
        applied += taken;
        allocations.push({ paymentId: payment.id, itemId: item.id, amount: fromPaisa(taken) });
        settledByItem.set(item.id, fromPaisa(toPaisa(settledByItem.get(item.id) ?? 0) + taken));
        if (item.remaining <= 0) cursor += 1;
      }

      if (applied > 0) appliedByPayment.set(payment.id, fromPaisa(applied));
      // Whatever is left over is an advance. It is not an error and it is not
      // handed back — it sits on the party's account until an invoice arrives
      // to absorb it.
      if (left > 0) advance[side] = fromPaisa(toPaisa(advance[side]) + left);
    }
  }

  return { allocations, settledByItem, appliedByPayment, advance };
}

// What an item's settlement state reads as on the statement.
export type SettlementState = "outstanding" | "partial" | "settled";

export function settlementState(amount: number, settled: number): SettlementState {
  const total = toPaisa(amount);
  const paid = toPaisa(settled);
  if (paid <= 0) return "outstanding";
  if (paid >= total) return "settled";
  return "partial";
}

// ---------------------------------------------------------------------------
// Running balance
// ---------------------------------------------------------------------------

// The one closing-balance formula used by the contact list and the individual
// statement. Keeping the paisa conversion here prevents tiny floating-point
// differences from making the outside figure disagree by 0.01.
export function closingBalance(opening: number, debit: number, credit: number): number {
  return fromPaisa(toPaisa(opening) + toPaisa(debit) - toPaisa(credit));
}

// The statement's Balance column, and nothing more than it: previous balance +
// debit - credit, seeded from the opening balance. Positive means the party owes
// us.
//
// The contact list uses this same sign, so its displayed payable/receivable must
// always agree exactly with the unfiltered statement closing balance.
export function runningBalances<T extends { debit: number; credit: number }>(
  opening: number,
  entries: readonly T[],
): (T & { balance: number })[] {
  let running = toPaisa(opening);
  return entries.map((entry) => {
    running = toPaisa(closingBalance(fromPaisa(running), entry.debit, entry.credit));
    return { ...entry, balance: fromPaisa(running) };
  });
}

// ---------------------------------------------------------------------------
// Impact of a change, before it is made
// ---------------------------------------------------------------------------

// One allocation the user is about to disturb. Enough to name it in a
// confirmation dialog: which payment, which invoice, and what happens to the
// amount tying them together.
export type AllocationImpact = {
  paymentId: string;
  itemId: string;
  before: number;
  after: number;
  effect: "released" | "reduced" | "increased" | "added";
};

const pairKey = (paymentId: string, itemId: string) => `${paymentId} ${itemId}`;

// Compares the allocations that exist now against the ones a recompute would
// produce, and returns only the pairs that move.
//
// This is what "listing exactly which payments/allocations will be affected"
// means: the list is derived from the same engine that runs on confirm, not
// from a guess about what might be touched.
export function allocationImpact(
  before: readonly FifoAllocation[],
  after: readonly FifoAllocation[],
): AllocationImpact[] {
  const beforeMap = new Map(before.map((a) => [pairKey(a.paymentId, a.itemId), a]));
  const afterMap = new Map(after.map((a) => [pairKey(a.paymentId, a.itemId), a]));
  const impacts: AllocationImpact[] = [];

  for (const [k, prev] of beforeMap) {
    const nextAmount = afterMap.get(k)?.amount ?? 0;
    if (toPaisa(nextAmount) === toPaisa(prev.amount)) continue;
    impacts.push({
      paymentId: prev.paymentId,
      itemId: prev.itemId,
      before: prev.amount,
      after: nextAmount,
      effect: nextAmount <= 0 ? "released" : nextAmount < prev.amount ? "reduced" : "increased",
    });
  }

  for (const [k, next] of afterMap) {
    if (beforeMap.has(k)) continue;
    impacts.push({ paymentId: next.paymentId, itemId: next.itemId, before: 0, after: next.amount, effect: "added" });
  }

  return impacts;
}

// Where the party's settlement stands right now: the two queues as the engine
// sees them, plus the allocations currently recorded against them.
export type SettlementSnapshot = {
  items: readonly SettleableItem[];
  payments: readonly SettlingPayment[];
  allocations: readonly FifoAllocation[];
};

// A change about to be made, expressed as what it does to the queues — enough to
// re-run FIFO against and diff, which is the only honest way to say what an edit
// will disturb.
//
// `amount` is the *settleable* value after the edit, not the document's grand
// total: an invoice part-settled at the counter only ever offers the remainder to
// the queue, so the caller subtracts that first.
export type LedgerChange =
  | { kind: "remove"; documentId: string }
  | { kind: "amount"; documentId: string; amount: number }
  | { kind: "date"; documentId: string; date: string }
  // documentId is null the first time an opening balance is set, since there is
  // no document to name yet.
  | { kind: "opening"; documentId: string | null; signedAmount: number };

const OPENING_PROJECTION_ID = "opening-balance";

// The queues as they would be after the change, without writing anything.
export function projectChange(
  snapshot: SettlementSnapshot,
  change: LedgerChange,
): { items: SettleableItem[]; payments: SettlingPayment[] } {
  const items = snapshot.items.map((i) => ({ ...i }));
  const payments = snapshot.payments.map((p) => ({ ...p }));

  if (change.kind === "opening") {
    const id = change.documentId ?? OPENING_PROJECTION_ID;
    const side = openingQueueSide(change.signedAmount);
    const at = items.findIndex((i) => i.id === id || i.isOpening);
    if (side === null) {
      // Cleared. It leaves the queue entirely rather than sitting there at zero.
      if (at !== -1) items.splice(at, 1);
      return { items, payments };
    }
    // The date is irrelevant — isOpening sorts it to the front either way — but a
    // real one keeps the comparators total.
    const projected: SettleableItem = {
      id,
      side,
      amount: Math.abs(change.signedAmount),
      date: at !== -1 ? items[at].date : "0001-01-01",
      createdAt: at !== -1 ? items[at].createdAt : "0001-01-01T00:00:00Z",
      isOpening: true,
    };
    if (at !== -1) items[at] = projected;
    else items.push(projected);
    return { items, payments };
  }

  const itemAt = items.findIndex((i) => i.id === change.documentId);
  const paymentAt = payments.findIndex((p) => p.id === change.documentId);

  if (change.kind === "remove") {
    if (itemAt !== -1) items.splice(itemAt, 1);
    if (paymentAt !== -1) payments.splice(paymentAt, 1);
    return { items, payments };
  }

  if (change.kind === "amount") {
    if (itemAt !== -1) items[itemAt] = { ...items[itemAt], amount: Math.max(0, change.amount) };
    if (paymentAt !== -1) payments[paymentAt] = { ...payments[paymentAt], amount: Math.max(0, change.amount) };
    return { items, payments };
  }

  if (itemAt !== -1) items[itemAt] = { ...items[itemAt], date: change.date };
  if (paymentAt !== -1) payments[paymentAt] = { ...payments[paymentAt], date: change.date };
  return { items, payments };
}

// The list a confirmation dialog shows. Empty means the change disturbs no
// existing allocation, which is the case that needs no confirmation at all.
export function impactOfChange(snapshot: SettlementSnapshot, change: LedgerChange): AllocationImpact[] {
  const { items, payments } = projectChange(snapshot, change);
  return allocationImpact(snapshot.allocations, settleFifo(items, payments).allocations);
}

// Enough of a document to name it to a person.
export type ImpactRef = { documentId: string; number: string; date: string; type: LedgerEntryType };

// An impact with both ends named, which is what crosses to the browser: the
// dialog must not have to look documents up, and the ids alone say nothing to
// the person deciding.
export type DescribedImpact = AllocationImpact & { payment: ImpactRef | null; item: ImpactRef | null };

export function describeImpacts(
  impacts: readonly AllocationImpact[],
  refs: ReadonlyMap<string, ImpactRef>,
): DescribedImpact[] {
  return impacts
    .map((impact) => ({
      ...impact,
      payment: refs.get(impact.paymentId) ?? null,
      item: refs.get(impact.itemId) ?? null,
    }))
    // Oldest affected item first, so the list reads in the same order as the
    // queue that produced it.
    .sort((a, b) =>
      (a.item?.date ?? "").localeCompare(b.item?.date ?? "") ||
      (a.payment?.date ?? "").localeCompare(b.payment?.date ?? "") ||
      a.itemId.localeCompare(b.itemId));
}
