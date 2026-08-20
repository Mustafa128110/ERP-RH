"use client";

import { useState } from "react";
import { ConvertQuotationDialog } from "@/components/modules/ConvertQuotationDialog";
import { QuotationForm, type QuotationDefaults } from "@/components/modules/QuotationForm";
import { primaryActionClass } from "@/components/ui/form-styles";
import type { QuotationLine } from "@/lib/actions/quotations";
import type { UnitConversionOption } from "@/lib/unit-conversion";

type Option = { id: string; name: string };
type ScopedOption = Option & { companyId: string };
type ItemOption = ScopedOption & { salesRate: string | null; baseUnitId: string | null; taxable: boolean };

// The edit form plus the one button that isn't part of it. Split out as a client
// component so the page above stays a server render — the dialog's open/closed
// state is the only thing here that needs the browser.
export function QuotationDetail({
  quotationId,
  defaults,
  lines,
  convertible,
  cancelled,
  companyOptions,
  customerOptions,
  itemOptions,
  unitOptions,
  taxOptions,
  conversionOptions,
  taxSettings,
}: {
  quotationId: string;
  defaults: QuotationDefaults;
  lines: QuotationLine[];
  // False once every line is fully invoiced — there is nothing left to convert.
  convertible: boolean;
  cancelled: boolean;
  companyOptions: Option[];
  customerOptions: ScopedOption[];
  itemOptions: ItemOption[];
  unitOptions: Option[];
  taxOptions: (Option & { rate: string })[];
  conversionOptions: UnitConversionOption[];
  taxSettings: Record<string, Record<string, string>>;
}) {
  const [converting, setConverting] = useState(false);

  return (
    <>
      <div className="flex shrink-0 justify-end">
        <button type="button" onClick={() => setConverting(true)} disabled={!convertible} className={primaryActionClass}>
          {cancelled ? "Cancelled" : convertible ? "Convert to Invoice" : "Fully invoiced"}
        </button>
      </div>

      {cancelled ? (
        <div className="rounded-lg border border-sand bg-white p-5 text-sm text-steel">
          This quotation is preserved as a cancelled record. It can no longer be edited or converted.
        </div>
      ) : (
        <QuotationForm
          quotationId={quotationId}
          defaults={defaults}
          companyOptions={companyOptions}
          customerOptions={customerOptions}
          itemOptions={itemOptions}
          unitOptions={unitOptions}
          taxOptions={taxOptions}
          conversionOptions={conversionOptions}
          taxSettings={taxSettings}
        />
      )}

      {converting && <ConvertQuotationDialog quotationId={quotationId} lines={lines} onClose={() => setConverting(false)} />}
    </>
  );
}
