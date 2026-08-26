"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useNewEntry } from "@/components/layout/KeyboardShortcuts";
import { Dialog } from "@/components/ui/Dialog";
import { DetailHover } from "@/components/ui/DetailHover";
import { DataTable } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { primaryIconButtonClass } from "@/components/ui/form-styles";
import { Icon } from "@/components/ui/Icon";
import type { ColumnDef, Row } from "@/lib/table";
import {
  PaymentEditForm,
  DeletePaymentButton,
  PaymentBatchAddDialog,
  type BankOption,
  type CashOption,
  type ChequeOption,
} from "@/components/modules/PaymentForm";
import { getPayment, listChequesForPayments } from "@/lib/actions/payments";
import type { ContactBalanceHint } from "@/lib/payment-constants";
import { formatDate, money } from "@/lib/format";
import { groupSameDay, type DayGroup } from "@/lib/day-groups";
import { useOptimisticRecords } from "@/lib/use-optimistic-records";
import { useCachedOptions } from "@/lib/client-cache";

type Option = { id: string; name: string };
type ScopedOption = Option & { companyId: string };
type PaymentDetail = NonNullable<Awaited<ReturnType<typeof getPayment>>>;
type PaymentCheques = Awaited<ReturnType<typeof listChequesForPayments>>;
type MethodDetail = { method: string; number: string; amount: string };

function readMethodDetails(value: Row[string]): MethodDetail[] {
  if (typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is MethodDetail =>
        typeof entry === "object" &&
        entry !== null &&
        typeof entry.method === "string" &&
        typeof entry.number === "string" &&
        typeof entry.amount === "string",
    );
  } catch {
    return [];
  }
}

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

const buildColumns = (): ColumnDef[] => [
  { key: "date", label: "Date" },
  {
    key: "type",
    label: "Type",
    render: (row) => (
      <span title={String(row.type)} className={String(row.type) === "Received" ? "text-emerald-600" : "text-red-500"}>
        <Icon name={String(row.type) === "Received" ? "arrowUp" : "arrowDown"} className="h-4 w-4" />
      </span>
    ),
  },
  { key: "contact", label: "Contact" },
  { key: "amount", label: "Amount", align: "right" },
  {
    key: "method",
    label: "Method",
    // A grouped row folded several payments together; when they paid by different
    // means the cell says "Mixed" and hovering lists which — naming one would
    // claim the others went the same way. The raw methods ride on the row as
    // `_methods` so the panel doesn't have to recompute the group.
    render: (row) => {
      if (String(row.method) !== "Mixed") return <span>{String(row.method)}</span>;
      const methods = readMethodDetails(row._methods);
      return (
        <DetailHover
          trigger={<span className="cursor-help underline decoration-dotted decoration-zinc-400 underline-offset-4">Mixed</span>}
          width={300}
          heading="Methods"
        >
          <table className="w-full text-sm">
            <tbody>
              {methods.map((m, i) => (
                <tr key={i} className="border-b border-sand/50 last:border-0">
                  <td className="py-1.5 pr-4 text-ink">{m.method}</td>
                  <td className="whitespace-nowrap py-1.5 pr-4 text-steel">{m.number}</td>
                  <td className="py-1.5 text-right tabular-nums text-ink">{m.amount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </DetailHover>
      );
    },
  },
  { key: "company", label: "Company" },
];

// What a payment row can honestly take from the form before the server has
// answered — and it is only these two.
//
// `amount` and `paymentDate` are stored verbatim (`grandTotal: values.amount`,
// `documentDate: values.paymentDate` in lib/actions/payments.ts), and they are
// the same raw values the row builder below formats, so the amount and the date
// change to exactly what was typed. A cheque payment posts no amount at all — it
// settles for the cheque's own registered figure, resolved server-side — so that
// key is simply absent and nothing is claimed about it.
//
// The contact is deliberately left alone even though the form posts one. An
// unrecognised name becomes a *new* contact on save, so it has no id yet; and the
// grouping key below is built from the contact id while the cell shows the name,
// so moving one without the other would file the row under a party it doesn't
// belong to. It waits for the payload.
function typedIntoRow(formData: FormData): Partial<PaymentRow> {
  const values: Partial<PaymentRow> = {};
  const amount = formData.get("amount");
  const paymentDate = formData.get("paymentDate");
  if (typeof amount === "string" && amount !== "") values.grandTotal = amount;
  if (typeof paymentDate === "string" && paymentDate !== "") values.documentDate = paymentDate;
  return values;
}


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
  chequeOptions: ChequeOption[];
  // The filter controls, built by the page — they drive query params, so the
  // filtering happens up there rather than over the rows already handed down.
  filters?: React.ReactNode;
}) {
  // Seed the client reference cache from the live options (so an offline batch
  // dialog can still fill its pickers) and fall back to the cached copy when the
  // page rendered empty. Live always wins when present.
  const cachedCompany = useCachedOptions("companies", companyOptions);
  const cachedContacts = useCachedOptions("contacts", contactOptions);
  const cachedBank = useCachedOptions("bankAccounts", bankAccountOptions);
  const cachedCash = useCachedOptions("cashAccounts", cashAccountOptions);
  const cachedCheques = useCachedOptions("cheques", chequeOptions);

  const [batchOpen, setBatchOpen] = useState(false);
  const [editing, setEditing] = useState<PaymentDetail | null>(null);
  const [editChequeOptions, setEditChequeOptions] = useState<ChequeOption[]>(chequeOptions);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  // Which grouped row was clicked: it stands for several payments, so there's no
  // single record to open until one is picked.
  const [choosing, setChoosing] = useState<DayGroup<PaymentRow> | null>(null);
  const router = useRouter();

  // The payments this list shows, which is the server's list plus whatever is in
  // flight. Applied to the payments themselves rather than to the grouped rows
  // below, so an edited amount re-totals its day line and a cancelled payment
  // leaves the group — or takes the whole line with it if it was the only one.
  const { records: shown, pending, patch, remove } = useOptimisticRecords(payments, "id");

  // Details already fetched, keyed by payment id. Opening one costs two round
  // trips to a database 170ms away; a pointer resting on the row is enough notice
  // to have made them already. Kept on a ref so warming never renders.
  const warmed = useRef(new Map<string, { detail: PaymentDetail; cheques: PaymentCheques }>());
  const warming = useRef(new Set<string>());

  async function warm(id: string) {
    if (warmed.current.has(id) || warming.current.has(id)) return;
    warming.current.add(id);
    try {
      const [detail, cheques] = await Promise.all([getPayment(id), listChequesForPayments(id)]);
      if (detail) warmed.current.set(id, { detail, cheques });
    } catch {
      // A failed warm is not a failure — the click will ask again, and if the
      // network is genuinely gone that is where it belongs to be reported.
    } finally {
      warming.current.delete(id);
    }
  }

  // Called from inside the form's own action when a save or a cancellation
  // starts, and it is not housekeeping: the warm copy was taken before this
  // write, so handing it to the next open would show the payment as it used to
  // be — worse than the round trip it saves.
  function forgetWarm(id: string) {
    warmed.current.delete(id);
  }

  function close() {
    setBatchOpen(false);
    setEditing(null);
    setChoosing(null);
  }

  async function openEdit(id: string) {
    const ready = warmed.current.get(id);
    if (ready) {
      setChoosing(null);
      setEditChequeOptions(ready.cheques);
      setEditing(ready.detail);
      return;
    }
    setLoadingId(id);
    const [detail, cheques] = await Promise.all([getPayment(id), listChequesForPayments(id)]);
    setLoadingId(null);
    setChoosing(null);
    if (detail) {
      // Worth keeping even though this open is already paid for: the same payment
      // is often opened twice in a row while a correction is worked out.
      warmed.current.set(id, { detail, cheques });
      setEditing(detail);
      setEditChequeOptions(cheques);
    }
  }

  // Several payments to one party on one day read as one line, so the list says
  // "this party, this day, this much" instead of repeating the party three times
  // with nothing tying the amounts together.
  const groups = groupSameDay(
    shown,
    (p) => (p.contactId ? `${p.companyId}|${p.contactId}|${p.documentDate}|${p.code}` : null),
    (p) => p.grandTotal,
  );
  const byRowId = new Map(groups.map((g) => [g.key, g]));
  const columns = buildColumns();

  // A row stands for a group, and `pending` holds payment ids, so a line fades
  // when any payment folded into it is in flight.
  const pendingRowIds = pending.length === 0 ? pending : groups.filter((g) => g.members.some((m) => pending.includes(m.id))).map((g) => g.key);

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
      // Per-payment methods for the "Mixed" hover panel — only meaningful when the
      // cell above collapsed to "Mixed", so it is omitted for single-method rows.
      _methods:
        methods.size > 1
          ? JSON.stringify(
              members.map((m) => ({
                method: m.paymentMethod ?? "—",
                number: m.number,
                amount: money(Number(m.grandTotal)),
              })),
            )
          : null,
      // Not rendered, but DataTable searches every value on a row: without this
      // the numbers folded into a group would stop being findable.
      _numbers: members.map((m) => m.number).join(" "),
    };
  });

  useNewEntry(() => setBatchOpen(true));

  return (
    <div className="flex h-full flex-col gap-2">
      <PageHeader
        title="Payments"
        subtitle={`${shown.length} payment(s)${shown.length !== groups.length ? ` on ${groups.length} line(s)` : ""}${filtered ? " matching" : ""}`}
      >
        {filters}
        <button
          type="button"
          onClick={() => setBatchOpen(true)}
          className={primaryIconButtonClass}
          aria-label="Add payments"
          title="Add payments — Alt+N"
        >
          <Icon name="plus" />
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
        // A line standing for several payments has no single record to warm, and
        // fetching all of them on a hover would cost more than the wait it saves.
        // Those are warmed from the chooser below instead, on the way past.
        onRowIntent={(row) => {
          const group = byRowId.get(String(row.id));
          if (!group || group.members.length !== 1) return;
          if (group.members[0].code === "PURCHASE_INVOICE") return;
          void warm(group.members[0].id);
        }}
        pendingIds={pendingRowIds}
        emptyMessage={filtered ? "No payments match these filters." : "No payments yet."}
        searchPlaceholder="Search payments…"
      />
      {loadingId && <p className="text-xs text-steel">Loading…</p>}

      {batchOpen && (
        <PaymentBatchAddDialog
          companyOptions={cachedCompany.value}
          contactOptions={cachedContacts.value}
          contactBalances={contactBalances}
          bankAccountOptions={cachedBank.value}
          cashAccountOptions={cachedCash.value}
          chequeOptions={cachedCheques.value}
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
                  onPointerEnter={() => void warm(p.id)}
                  onTouchStart={() => void warm(p.id)}
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
        // Hidden rather than closed while this payment's write is in the air. The
        // server may still have something to say — a cancellation that would put
        // settled invoices back to outstanding is refused once, with the figures —
        // and a hidden popup keeps that question and everything typed standing;
        // a closed one would have thrown both away. `pending` empties when the
        // action settles, so a refusal brings the popup straight back, and a
        // success closes it for real from onDone.
        <Dialog
          title={editing.direction === "made" ? "Edit Payment Made" : "Edit Payment Received"}
          onClose={close}
          hidden={pending.includes(editing.id)}
        >
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
              onSaving={(formData) => {
                forgetWarm(editing.id);
                patch(editing.id, typedIntoRow(formData));
              }}
            />
            <div className="rounded border border-error/30 bg-error-tint p-4">
              <DeletePaymentButton
                paymentId={editing.id}
                onDone={close}
                onDeleting={() => {
                  forgetWarm(editing.id);
                  remove(editing.id);
                }}
              />
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}
