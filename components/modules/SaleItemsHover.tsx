"use client";

import type { SaleItemRow } from "@/lib/actions/sales";
import { DetailHover } from "@/components/ui/DetailHover";
import { qty } from "@/lib/format";

// The sales list has room for the invoice number, but "what was on SI-0007" is the
// question you actually want answered while scanning it. Hovering the number
// answers it without opening the sale.
export function SaleItemsHover({ number, items }: { number: string; items: SaleItemRow[] }) {
  if (items.length === 0) return <>{number}</>;

  return (
    <DetailHover
      trigger={number}
      heading={`${items.length} item${items.length === 1 ? "" : "s"}`}
      lines={items.map((it) => ({
        text: it.itemName,
        value: `${qty(it.quantity)} ${it.unitSymbol ?? ""}`.trim(),
      }))}
    />
  );
}
