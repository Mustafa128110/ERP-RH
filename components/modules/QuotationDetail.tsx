"use client";

import { useState } from "react";
import { ConvertQuotationDialog } from "@/components/modules/ConvertQuotationDialog";
import { QuotationForm, type QuotationDefaults } from "@/components/modules/QuotationForm";
import { primaryActionClass } from "@/components/ui/form-styles";
import type { QuotationLine } from "@/lib/actions/quotations";

type Option = { id: string; name: string };
type ScopedOption = Option & { companyId: string };
type ItemOption = ScopedOption & { salesRate: string | null };

// The edit form plus the one button that isn't part of it. Split out as a client
// component so the page above stays a server render — the dialog's open/closed
// state is the only thing here that needs the browser.
export function QuotationDetail({
  quotationId,
  defaults,
  lines,
  convertible,
  companyOptions,
  customerOptions,
  itemOptions,
  unitOptions,
}: {
  quotationId: string;
  defaults: QuotationDefaults;
  lines: QuotationLine[];
  // False once every line is fully invoiced — there is nothing left to convert.
  convertible: boolean;
  companyOptions: Option[];
  customerOptions: ScopedOption[];
  itemOptions: ItemOption[];
  unitOptions: Option[];
}) {
  const [converting, setConverting] = useState(false);

  return (
    <>
      <div className="flex shrink-0 justify-end">
        <button type="button" onClick={() => setConverting(true)} disabled={!convertible} className={primaryActionClass}>
          {convertible ? "Convert to Invoice" : "Fully invoiced"}
        </button>
      </div>

      <QuotationForm
        quotationId={quotationId}
        defaults={defaults}
        companyOptions={companyOptions}
        customerOptions={customerOptions}
        itemOptions={itemOptions}
        unitOptions={unitOptions}
      />

      {converting && <ConvertQuotationDialog quotationId={quotationId} lines={lines} onClose={() => setConverting(false)} />}
    </>
  );
}
