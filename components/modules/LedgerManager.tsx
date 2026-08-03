"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createLedgerEntry, setContactBalance, type ContactLedgerBalance } from "@/lib/actions/ledger";
import { Dialog } from "@/components/ui/Dialog";
import { DataTable } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { ComboBox } from "@/components/ui/ComboBox";
import { ContactPaymentsHover } from "@/components/modules/ContactPaymentsHover";
import { DateField } from "@/components/ui/DateField";
import { fieldClass, labelClass, labelTextClass, errorTextClass, primaryActionClass } from "@/components/ui/form-styles";
import type { ColumnDef, Row } from "@/lib/table";
import { money, todayISO } from "@/lib/format";
import { inCompany } from "@/lib/contact-scope";

const readOnlyClass = `${fieldClass} flex items-center bg-ivory text-steel`;



// The ledger holds both sides — unpaid purchases (we owe the supplier) and the
// unpaid part of a sale (the customer owes us) — so the columns say which
// direction each balance runs rather than just "credit" and "debt".
// `render` closes over the balances so the contact cell can carry the hover panel
// — Row only holds primitives, and the recent payments are a list.
const buildColumns = (byRowId: Map<string, ContactLedgerBalance>): ColumnDef[] => [
  {
    key: "displayName",
    label: "Contact",
    render: (row) => {
      const balance = byRowId.get(String(row.id));
      return balance ? <ContactPaymentsHover name={balance.displayName} payments={balance.recentPayments} /> : String(row.displayName);
    },
  },
  { key: "company", label: "Company" },
  { key: "creditBalance", label: "We Owe", align: "right" },
  { key: "debtBalance", label: "Owes Us", align: "right" },
];

type Option = { id: string; name: string };
type ScopedOption = Option & { companyId: string };
type ModalState = { kind: "add" } | { kind: "edit"; balance: ContactLedgerBalance } | null;

export function LedgerManager({
  balances,
  companyOptions,
  contactOptions,
  filter,
}: {
  balances: ContactLedgerBalance[];
  companyOptions: Option[];
  contactOptions: ScopedOption[];
  // The company filter, built by the page — it drives a query param, so the
  // filtering happens up there rather than over the rows already handed down.
  filter?: React.ReactNode;
}) {
  const [modal, setModal] = useState<ModalState>(null);
  const router = useRouter();

  function close() {
    setModal(null);
    router.refresh();
  }

  const byRowId = new Map(balances.map((b) => [`${b.companyId}:${b.contactId}`, b]));
  const columns = buildColumns(byRowId);

  const rows: Row[] = balances.map((b) => ({
    // A contact can hold a balance in both companies, so the row key is the pair
    // — the contact id alone would collide and React would drop one of them.
    id: `${b.companyId}:${b.contactId}`,
    displayName: b.displayName,
    company: b.company,
    // balance > 0: still owed to the contact (unpaid purchase). balance < 0: the
    // contact owes us — an unpaid or part-paid sale, or an overpayment.
    creditBalance: b.balance > 0 ? money(b.balance) : "—",
    debtBalance: b.balance < 0 ? money(-b.balance) : "—",
  }));

  return (
    <div className="flex h-full flex-col gap-4">
      <PageHeader title="Ledger" subtitle={`${balances.length} contact(s) with ledger activity`}>
        {filter}
        <button type="button" onClick={() => setModal({ kind: "add" })} className={primaryActionClass}>
          + Add Entry
        </button>
      </PageHeader>

      <DataTable
        columns={columns}
        rows={rows}
        idKey="id"
        onRowClick={(row) => {
          const balance = byRowId.get(String(row.id));
          if (balance) setModal({ kind: "edit", balance });
        }}
        emptyMessage="No ledger activity yet."
        searchPlaceholder="Search contacts…"
      />

      {modal?.kind === "add" && (
        <Dialog title="Add Ledger Entry" onClose={() => setModal(null)}>
          <LedgerEntryForm companyOptions={companyOptions} contactOptions={contactOptions} onClose={close} />
        </Dialog>
      )}

      {modal?.kind === "edit" && (
        <Dialog title={modal.balance.displayName} onClose={() => setModal(null)}>
          <LedgerEntryForm balance={modal.balance} companyOptions={companyOptions} contactOptions={contactOptions} onClose={close} />
        </Dialog>
      )}
    </div>
  );
}

// One form for both jobs.
//
// Adding: a balance that didn't come from a sale or a purchase — an opening
// balance from the old books, a correction, something settled off-invoice.
//
// Editing a contact's row: the same fields, prefilled with where that contact
// stands. The company and the contact are what identify the row, so they're
// shown but fixed; the direction and amount are the balance itself, and changing
// them is what gets saved.
function LedgerEntryForm({
  balance,
  companyOptions,
  contactOptions,
  onClose,
}: {
  balance?: ContactLedgerBalance;
  companyOptions: Option[];
  contactOptions: ScopedOption[];
  onClose: () => void;
}) {
  const isEdit = !!balance;
  const [state, action, pending] = useActionState(
    isEdit ? setContactBalance.bind(null, balance.companyId, balance.contactId) : createLedgerEntry,
    undefined,
  );
  const [companyId, setCompanyId] = useState(
    () => balance?.companyId ?? companyOptions.find((c) => c.name === "Royal Hardware")?.id ?? "",
  );
  const [contactText, setContactText] = useState(() => balance?.displayName ?? "");
  const [contactId, setContactId] = useState(() => balance?.contactId ?? "");

  useEffect(() => {
    if (state?.success) onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.success]);

  // A contact scoped to a company belongs to that one; a global contact belongs
  // to all of them. Switching company drops a stale pick either way.
  const visibleContacts = contactOptions.filter(inCompany(companyId));

  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-3">
        <div className={`${labelClass} w-52`}>
          <span className={labelTextClass}>Company</span>
          {isEdit ? (
            <p className={readOnlyClass}>{balance.company}</p>
          ) : (
            <select
              name="companyId"
              required
              value={companyId}
              onChange={(e) => {
                setCompanyId(e.target.value);
                setContactId("");
                setContactText("");
              }}
              className={fieldClass}
            >
              <option value="" disabled>
                Select a company
              </option>
              {companyOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className={`${labelClass} w-56`}>
          <span className={labelTextClass}>Contact</span>
          {isEdit ? (
            <p className={readOnlyClass}>{balance.displayName}</p>
          ) : (
            <>
              <ComboBox
                value={contactText}
                options={visibleContacts}
                placeholder="Pick a contact or type a new one"
                className={fieldClass}
                inputProps={{ required: true }}
                onChange={(name) => {
                  setContactText(name);
                  setContactId(visibleContacts.find((c) => c.name === name)?.id ?? "");
                }}
              />
              <input type="hidden" name="contactId" value={contactId} />
              <input type="hidden" name="contactName" value={contactText} />
            </>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <label className={`${labelClass} w-52`}>
          <span className={labelTextClass}>Direction</span>
          <select
            name="direction"
            required
            defaultValue={balance ? (balance.balance > 0 ? "we_owe" : "owes_us") : "owes_us"}
            className={fieldClass}
          >
            <option value="owes_us">Owes Us</option>
            <option value="we_owe">We Owe</option>
          </select>
        </label>
        <label className={`${labelClass} w-40`}>
          <span className={labelTextClass}>Amount</span>
          <input
            name="amount"
            type="number"
            min="0.01"
            step="0.01"
            required
            defaultValue={balance ? Math.abs(balance.balance).toFixed(2) : undefined}
            className={fieldClass}
          />
        </label>
        <label className={`${labelClass} w-40`}>
          <span className={labelTextClass}>Date</span>
          <DateField name="documentDate" required defaultValue={todayISO()} className={fieldClass} />
        </label>
      </div>

      <label className={labelClass}>
        <span className={labelTextClass}>Note</span>
        <input name="note" type="text" placeholder="Opening balance, correction, …" className={fieldClass} />
      </label>

      {isEdit && (
        <p className="text-sm text-steel">
          This balance is the sum of {balance.displayName}&apos;s invoices, payments and earlier entries, so saving a different number posts the
          difference as a dated correction rather than rewriting what&apos;s already recorded.
        </p>
      )}

      {state?.error && <p className={errorTextClass}>{state.error}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={primaryActionClass}>
          {pending ? "Saving…" : isEdit ? "Save Balance" : "Add Entry"}
        </button>
        <button type="button" onClick={onClose} className="h-11 rounded px-4 text-sm font-medium text-steel hover:bg-ivory">
          Cancel
        </button>
      </div>
    </form>
  );
}
