"use client";

import type { ContactPayment } from "@/lib/actions/ledger";
import { DetailHover } from "@/components/ui/DetailHover";
import { formatDate, money } from "@/lib/format";

// Shows last 6 payments made and last 6 received for a contact in the ledger.
export function ContactPaymentsHover({ name, paymentsMade, paymentsReceived }: {
  name: string;
  paymentsMade: ContactPayment[];
  paymentsReceived: ContactPayment[];
}) {
  if (paymentsMade.length === 0 && paymentsReceived.length === 0) return <>{name}</>;

  const all = [...paymentsMade, ...paymentsReceived];

  return (
    <DetailHover trigger={name} width={320}>
      <div className="flex flex-col gap-0.5 text-sm">
        {all.map((p, i) => (
          <div key={i} className="grid grid-cols-[auto_1fr_auto_auto] gap-x-3">
            <span className="text-steel tabular-nums">{formatDate(p.date)}</span>
            <span className={p.direction === "made" ? "text-red-500" : "text-emerald-600"}>
              {p.direction === "made" ? "paid" : "received"}
            </span>
            <span className="text-right tabular-nums text-ink">{money(p.amount)}</span>
            <span className="text-right tabular-nums text-steel text-xs">{p.number}</span>
          </div>
        ))}
      </div>
    </DetailHover>
  );
}
