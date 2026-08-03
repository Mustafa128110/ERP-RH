"use client";

import type { ContactPayment } from "@/lib/actions/ledger";
import { DetailHover } from "@/components/ui/DetailHover";
import { formatDate, money } from "@/lib/format";

// Same idea as the sales list's item panel: the ledger row has the balance, but
// "when did we last pay them, and how much" is what you actually want while
// scanning it. Hovering the contact name answers it without leaving the page.
export function ContactPaymentsHover({ name, payments }: { name: string; payments: ContactPayment[] }) {
  if (payments.length === 0) return <>{name}</>;

  return (
    <DetailHover
      trigger={name}
      heading={`Last ${payments.length} payment${payments.length === 1 ? "" : "s"}`}
      lines={payments.map((p) => ({
        text: formatDate(p.date),
        // Which way the money went — a contact can be paid on one invoice and
        // pay us on another.
        note: p.direction === "made" ? "paid them" : "received",
        value: money(p.amount),
      }))}
      width={288}
    />
  );
}
