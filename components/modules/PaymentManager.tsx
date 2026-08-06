"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useNewEntry } from "@/components/layout/KeyboardShortcuts";
import { Dialog } from "@/components/ui/Dialog";
import { DataTable } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { DetailHover } from "@/components/ui/DetailHover";
import { primaryActionClass } from "@/components/ui/form-styles";
import type { ColumnDef, Row } from "@/lib/table";
import { PaymentEditForm, DeletePaymentButton, PaymentBatchAddDialog, type BankOption, type CashOption } from "@/components/modules/PaymentForm";
import { getPayment, listChequesForPayments } from "@/lib/actions/payments";
import type { ContactBalanceHint } from "@/lib/payment-constants";
import { formatDate, money } from "@/lib/format";
import { groupSameDay, type DayGroup } from "@/lib/day-groups";

type Option = { id: string; name: string };
type ScopedOption = Option & { companyId: string };
type PaymentDetail = NonNullable<Awaited<ReturnType<typeof getPayment>>>;

interface PaymentRow {
  id: string;
  number: string;
  documentDate: string;
  grandTotal: string;
  companyId: string;
  company: string;
  contactId: string | null;
  contact: string | null;
  paymentMethod: string | null;
  code: string;
}

// `render` closes over the grouped payments so the number cell can list them —
// Row only holds primitives, and a group's members are a list.
const buildColumns = (byRowId: Map<string, DayGroup<PaymentRow>>): ColumnDef[] => [
  {
    key: "number",
    label: "Number",
    // The row shows the amount and the method; what it doesn't show is the whole
    // of a payment at a glance — which way it went, whose account it moved
    // through, under which company. Hovering the number answers that without
    // opening the record.
    //
    // A row standing for several payments to one party on one day is asked a
    // different question, so it gets the other panel: what each of them was, and
    // what they came to.
    render: (row) => {
      const members = byRowId.get(String(row.id))?.members ?? [];
      return members.length > 1 ? (
        <DetailHover
          trigger={String(row.number)}
          heading={`${row.contact} — ${row.date}`}
          width={340}
          lines={members.map((m) => ({
            text: m.number,
            note: m.paymentMethod ?? undefined,
            value: money(m.grandTotal),
          }))}
          footer={`Total ${row.amount}`}
        />
      ) : (
        <DetailHover
          trigger={String(row.number)}
          heading={String(row.number)}
          rows={[
            { label: row.type === "Made" ? "Paid to" : "Received from", value: String(row.contact) },
            { label: "Amount", value: String(row.amount) },
            { label: "Through", value: String(row.method) },
            { label: "Company", value: String(row.company) },
            { label: "Date", value: String(row.date) },
          ]}
        />
      );
    },
  },
  { key: "type", label: "Type", badge: true },
  { key: "contact", label: "Contact" },
  { key: "date", label: "Date" },
  { key: "method", label: "Method" },
  { key: "amount", label: "Amount", align: "right" },
  { key: "company", label: "Company" },
];


export function PaymentManager({
  payments,
  filtered,
  companyOptions,
  contactOptions,
  contactBalances,
  bankAccountOptions,
  cashAccountOptions,
  chequeOptions,
  filters,
}: {
  payments: PaymentRow[];
  // Whether any filter is on, so an empty list can say why it's empty.
  filtered?: boolean;
  companyOptions: Option[];
  contactOptions: ScopedOption[];
  // Per company, where each contact's ledger stands — a new payment reads it to
  // land in the books holding the balance it settles (lib/payment-constants.ts).
  contactBalances: ContactBalanceHint[];
  bankAccountOptions: BankOption[];
  cashAccountOptions: CashOption[];
  chequeOptions: Option[];
  // The filter controls, built by the page — they drive query params, so the
  // filtering happens up there rather than over the rows already handed down.
  filters?: React.ReactNode;
}) {
  const [batchOpen, setBatchOpen] = useState(false);
  const [editing, setEditing] = useState<PaymentDetail | null>(null);
  const [editChequeOptions, setEditChequeOptions] = useState<Option[]>(chequeOptions);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  // Which grouped row was clicked: it stands for several payments, so there's no
  // single record to open until one is picked.
  const [choosing, setChoosing] = useState<DayGroup<PaymentRow> | null>(null);
  const router = useRouter();

  function close() {
    setBatchOpen(false);
    setEditing(null);
    setChoosing(null);
    router.refresh();
  }

  async function openEdit(id: string) {
    setLoadingId(id);
    const [detail, cheques] = await Promise.all([getPayment(id), listChequesForPayments(id)]);
    setLoadingId(null);
    setChoosing(null);
    if (detail) {
      setEditing(detail);
      setEditChequeOptions(cheques);
    }
  }

  // Several payments to one party on one day read as one line, so the list says
  // "this party, this day, this much" instead of repeating the party three times
  // with nothing tying the amounts together.
  const groups = groupSameDay(
    payments,
    (p) => (p.contactId ? `${p.companyId}|${p.contactId}|${p.documentDate}|${p.code}` : null),
    (p) => p.grandTotal,
  );
  const byRowId = new Map(groups.map((g) => [g.key, g]));
  const columns = buildColumns(byRowId);

  const rows: Row[] = groups.map(({ key, members, total }) => {
    const first = members[0];
    const methods = new Set(members.map((m) => m.paymentMethod ?? "—"));
    return {
      // The group key, not a payment id — a grouped row doesn't stand for one
      // record, and openEdit is given the id it picks rather than the row's.
      id: key,
      number: members.length > 1 ? `${first.number} +${members.length - 1} more` : first.number,
      // A purchase settled on the spot is money out, and says where it came
      // from: it's edited on the purchase itself, not here.
      type: first.code === "PURCHASE_INVOICE" ? "Made (purchase)" : first.code === "PAYMENT_MADE" ? "Made" : "Received",
      contact: first.contact ?? "—",
      date: formatDate(first.documentDate),
      // One method named, or the fact that they differ — naming the first would
      // claim the other two went the same way.
      method: methods.size === 1 ? [...methods][0] : "Mixed",
      amount: `${first.code === "PAYMENT_RECEIVED" ? "+" : "-"}${money(total)}`,
      company: first.company,
      // Not rendered, but DataTable searches every value on a row: without this
      // the numbers folded into a group would stop being findable.
      _numbers: members.map((m) => m.number).join(" "),
    };
  });

  useNewEntry(() => setBatchOpen(true));

  return (
    <div className="flex h-full flex-col gap-4">
      <PageHeader
        title="Payments"
        subtitle={`${payments.length} payment(s)${payments.length !== groups.length ? ` on ${groups.length} line(s)` : ""}${filtered ? " matching" : ""}`}
      >
        {filters}
        <button type="button" onClick={() => setBatchOpen(true)} className={primaryActionClass}>
          + Add Payments
        </button>
      </PageHeader>

      <DataTable
        columns={columns}
        rows={rows}
        idKey="id"
        onRowClick={(row) => {
          const group = byRowId.get(String(row.id));
          if (!group) return;
          // A purchase's own settlement is edited on the purchase — opening the
          // payment form on it would offer to change a payment that doesn't
          // exist as a document.
          if (group.members[0].code === "PURCHASE_INVOICE") {
            router.push("/purchases/stock");
            return;
          }
          if (group.members.length === 1) openEdit(group.members[0].id);
          else setChoosing(group);
        }}
        emptyMessage={filtered ? "No payments match these filters." : "No payments yet."}
        searchPlaceholder="Search payments…"
      />
      {loadingId && <p className="text-xs text-steel">Loading…</p>}

      {batchOpen && (
        <PaymentBatchAddDialog
          companyOptions={companyOptions}
          contactOptions={contactOptions}
          contactBalances={contactBalances}
          bankAccountOptions={bankAccountOptions}
          cashAccountOptions={cashAccountOptions}
          chequeOptions={chequeOptions}
          onClose={() => setBatchOpen(false)}
          onDone={close}
        />
      )}

      {/* A grouped row is several records, so clicking it asks which one before
          opening an edit form for it. */}
      {choosing && (
        <Dialog title={`${choosing.members[0].contact} — ${formatDate(choosing.members[0].documentDate)}`} onClose={() => setChoosing(null)}>
          <ul className="flex flex-col">
            {choosing.members.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => openEdit(p.id)}
                  className="flex w-full items-baseline justify-between gap-4 border-b border-sand px-1 py-3 text-left hover:bg-brass-100"
                >
                  <span className="text-ink">{p.number}</span>
                  <span className="text-sm text-steel">{p.paymentMethod ?? "—"}</span>
                  <span className="tabular-nums text-ink">{money(p.grandTotal)}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="flex justify-between px-1 pt-3 font-semibold text-ink">
            <span>Total</span>
            <span className="tabular-nums">{money(choosing.total)}</span>
          </p>
        </Dialog>
      )}

      {editing && (
        <Dialog title={editing.direction === "made" ? "Edit Payment Made" : "Edit Payment Received"} onClose={close}>
          <div className="flex flex-col gap-4">
            <PaymentEditForm
              paymentId={editing.id}
              direction={editing.direction}
              defaults={editing}
              companyOptions={companyOptions}
              contactOptions={contactOptions}
              bankAccountOptions={bankAccountOptions}
              cashAccountOptions={cashAccountOptions}
              chequeOptions={editChequeOptions}
              onDone={close}
            />
            <div className="rounded border border-error/30 bg-error-tint p-4">
              <DeletePaymentButton paymentId={editing.id} onDone={close} />
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}
