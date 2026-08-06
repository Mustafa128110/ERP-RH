"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { formatDate, money, todayISO } from "@/lib/format";
import type { ContactLedgerBalance } from "@/lib/actions/ledger";

// What the ledger looks like when it leaves the building: a balance sheet for
// the business, and a statement of account for one contact.
//
// Both are documents, not screens — letterhead, a date, a total that adds up —
// because the thing they're compared against is the copy the other side is
// holding. One layout each, photographed for the image and printed to A4 for the
// PDF (lib/node-download.ts), so the two files can't disagree.

// The company as it appears on paper. Nullable everywhere: a company record with
// no address on file simply prints without one.
export type Letterhead = {
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  taxNumber: string | null;
};

function Header({ company, title, subtitle }: { company: Letterhead; title: string; subtitle: string }) {
  return (
    <div className="flex items-start justify-between gap-6 border-b-2 border-navy-800 pb-4">
      <div>
        <h1 className="text-2xl font-semibold text-navy-800">{company.name}</h1>
        {company.address && <p className="mt-1 whitespace-pre-line text-sm text-steel">{company.address}</p>}
        <p className="text-sm text-steel">{[company.phone, company.email].filter(Boolean).join(" · ")}</p>
        {company.taxNumber && <p className="text-sm text-steel">NTN: {company.taxNumber}</p>}
      </div>
      <div className="text-right">
        <p className="text-xs font-semibold uppercase tracking-wide text-steel">{title}</p>
        <p className="mt-1 text-sm text-ink">{subtitle}</p>
        <p className="mt-1 text-sm text-steel">As at {formatDate(todayISO())}</p>
      </div>
    </div>
  );
}

// One side of the ledger, listed and totalled. Rendered even when empty — a
// balance sheet that silently omits "Receivable" reads as though nobody owes
// anything, which is a different statement from having no receivables.
function Side({ title, rows, amountOf }: { title: string; rows: ContactLedgerBalance[]; amountOf: (row: ContactLedgerBalance) => number }) {
  const total = rows.reduce((sum, r) => sum + amountOf(r), 0);

  return (
    <div className="mt-6">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-navy-800">{title}</h2>
      <table className="mt-2 w-full border-collapse text-sm">
        <thead>
          <tr className="border-y border-sand">
            <th className="py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-steel">Contact</th>
            <th className="w-32 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-steel">Books</th>
            <th className="w-36 py-1.5 text-right text-xs font-semibold uppercase tracking-wide text-steel">Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr className="border-b border-sand">
              <td className="py-1.5 text-steel" colSpan={3}>
                None.
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={`${r.companyId}:${r.contactId}`} className="border-b border-sand">
                <td className="py-1.5">{r.displayName}</td>
                <td className="py-1.5 text-steel">{r.company}</td>
                <td className="py-1.5 text-right tabular-nums">{money(amountOf(r))}</td>
              </tr>
            ))
          )}
        </tbody>
        <tfoot>
          <tr>
            <td className="py-1.5 font-semibold" colSpan={2}>
              Total {title}
            </td>
            <td className="py-1.5 text-right font-semibold tabular-nums">{money(total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// The business's own position: what it is owed, what it owes, and the difference
// between them. Sorted biggest first — the largest balance is the one anyone
// reading this is looking for.
//
// Nothing renders this at the moment: the ledger page took its download buttons
// off, and statements go out one contact at a time. Kept because it is the whole
// balance sheet and the next screen that wants one — a report, a month end —
// should not draw a third version of it.
export function BalanceSheetDocument({ company, books, rows }: { company: Letterhead; books: string; rows: ContactLedgerBalance[] }) {
  const receivable = rows.filter((r) => r.balance < 0).sort((a, b) => a.balance - b.balance);
  const payable = rows.filter((r) => r.balance > 0).sort((a, b) => b.balance - a.balance);
  const totalReceivable = receivable.reduce((sum, r) => sum - r.balance, 0);
  const totalPayable = payable.reduce((sum, r) => sum + r.balance, 0);
  const net = totalReceivable - totalPayable;

  return (
    <div className="w-full bg-white p-10 text-ink">
      <Header company={company} title="Balance Sheet" subtitle={books} />

      <Side title="Receivable — Owes Us" rows={receivable} amountOf={(r) => -r.balance} />
      <Side title="Payable — We Owe" rows={payable} amountOf={(r) => r.balance} />

      {/* The one line the sheet exists for: in the black or in the red, on the
          ledger alone. Stock, cash and the bank are not in this figure. */}
      <div className="mt-8 flex justify-end">
        <dl className="grid w-80 grid-cols-[1fr_auto] gap-y-1 border-t-2 border-navy-800 pt-2 text-sm">
          <dt className="text-steel">Total receivable</dt>
          <dd className="text-right tabular-nums">{money(totalReceivable)}</dd>
          <dt className="text-steel">Total payable</dt>
          <dd className="text-right tabular-nums">-{money(totalPayable)}</dd>
          <dt className="mt-1 border-t border-sand pt-1 font-semibold">Net position</dt>
          <dd className="mt-1 border-t border-sand pt-1 text-right font-semibold tabular-nums">{money(net)}</dd>
        </dl>
      </div>

      <p className="mt-10 border-t border-sand pt-3 text-xs text-steel">
        Contact balances as recorded: invoices raised and payments received or made. Stock, cash and bank balances are not included.
      </p>
    </div>
  );
}

// One contact's account, as they would want to check it against their own book:
// what each side has come to, where that leaves the balance, and the payments
// behind it.
export function ContactStatementDocument({ company, row }: { company: Letterhead; row: ContactLedgerBalance }) {
  const owesUs = row.balance < 0;
  const outstanding = Math.abs(row.balance);

  return (
    <div className="w-full bg-white p-10 text-ink">
      <Header company={company} title="Statement of Account" subtitle={row.displayName} />

      <div className="mt-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-steel">Account of</p>
        <p className="mt-1 text-base font-medium">{row.displayName}</p>
        <p className="text-sm text-steel">{row.company}</p>
      </div>

      {/* Credit and debit spelled out in the words the ledger uses on screen,
          rather than the accounting terms — this copy is read by whoever the
          balance is with, not by a bookkeeper. */}
      <div className="mt-6 flex justify-end">
        <dl className="grid w-96 grid-cols-[1fr_auto] gap-y-1 text-sm">
          <dt className="text-steel">Billed to us (purchases, credits)</dt>
          <dd className="text-right tabular-nums">{money(row.credit)}</dd>
          <dt className="text-steel">Billed to them, and payments made</dt>
          <dd className="text-right tabular-nums">{money(row.debit)}</dd>
          <dt className="mt-1 border-t-2 border-navy-800 pt-2 text-base font-semibold">{owesUs ? "Owes us" : "We owe"}</dt>
          <dd className="mt-1 border-t-2 border-navy-800 pt-2 text-right text-base font-semibold tabular-nums">{money(outstanding)}</dd>
        </dl>
      </div>

      <div className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-navy-800">Recent payments</h2>
        <table className="mt-2 w-full border-collapse text-sm">
          <thead>
            <tr className="border-y border-sand">
              <th className="w-32 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-steel">Date</th>
              <th className="py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-steel">Reference</th>
              <th className="w-32 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-steel">Direction</th>
              <th className="w-36 py-1.5 text-right text-xs font-semibold uppercase tracking-wide text-steel">Amount</th>
            </tr>
          </thead>
          <tbody>
            {row.recentPayments.length === 0 ? (
              <tr className="border-b border-sand">
                <td className="py-1.5 text-steel" colSpan={4}>
                  No payments recorded.
                </td>
              </tr>
            ) : (
              row.recentPayments.map((p) => (
                <tr key={p.number} className="border-b border-sand">
                  <td className="py-1.5">{formatDate(p.date)}</td>
                  <td className="py-1.5">{p.number}</td>
                  <td className="py-1.5 text-steel">{p.direction === "made" ? "Paid to them" : "Received from them"}</td>
                  <td className="py-1.5 text-right tabular-nums">{money(p.amount)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-10 border-t border-sand pt-3 text-xs text-steel">
        Please check this against your own records and tell us of any difference. Payments recorded after the date above are not included.
      </p>
    </div>
  );
}

// Mounted out of sight for the moment it takes to photograph whatever document
// it's given. `onReady` fires from an effect, which React runs after the browser
// has laid the thing out — the ordering that makes the picture come out at full
// height instead of blank.
//
// "Out of sight" is behind the page, not off the side of it. The obvious
// approach — park it at left:-10000px — produced no file at all: html2canvas
// renders through the element's position on the page, and a node parked outside
// the document photographs as nothing, which fails downstream rather than
// returning a blank. Behind, at z-index -1000 under the app's own background,
// it has an ordinary box in an ordinary place and rasterises like anything else.
// display:none and visibility:hidden are out for the same underlying reason:
// no layout, nothing to measure.
//
// The width is the paper: 900px keeps the tables from cramping at A4.
export function SheetRenderer({ children, onReady }: { children: ReactNode; onReady: (node: HTMLElement) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  // Development mounts this twice to check its cleanup; the far end of onReady
  // writes a file, and twice is one file too many.
  const taken = useRef(false);

  useEffect(() => {
    if (taken.current) return;
    // The document itself, not the wrapper holding it off-screen: html2canvas
    // renders a node with its own computed styles, and photographing something
    // positioned 10,000px to the left captures the empty space it left behind.
    const node = ref.current?.firstElementChild as HTMLElement | null;
    if (!node) return;
    taken.current = true;
    onReady(node);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={ref} aria-hidden className="pointer-events-none fixed top-0 left-0 z-[-1000] w-[900px] bg-white">
      {children}
    </div>
  );
}
