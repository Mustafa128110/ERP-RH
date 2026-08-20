"use client";

import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { useNewEntry } from "@/components/layout/KeyboardShortcuts";
import { createLedgerEntry, setContactBalance, type ContactLedgerBalance } from "@/lib/actions/ledger";
import { Dialog } from "@/components/ui/Dialog";
import { DataTable } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { ComboBox } from "@/components/ui/ComboBox";
import { ContactPaymentsHover } from "@/components/modules/ContactPaymentsHover";
import { LedgerDocHover } from "@/components/modules/LedgerDocHover";
import { DateField } from "@/components/ui/DateField";
import { fieldClass, labelClass, labelTextClass, errorTextClass, primaryActionClass, primaryIconButtonClass, TRANSPORT_ERROR_MESSAGE } from "@/components/ui/form-styles";
import { Icon } from "@/components/ui/Icon";
import type { ColumnDef, Row } from "@/lib/table";
import { money, todayISO } from "@/lib/format";
import { downloadNodeAsPdf, downloadNodeAsPng } from "@/lib/node-download";
import { ContactStatementDocument, SheetRenderer, type Letterhead } from "@/components/modules/LedgerSheet";
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
      return balance ? <ContactPaymentsHover name={balance.displayName} paymentsMade={balance.recentPayments.filter((p) => p.direction === "made")} paymentsReceived={balance.recentPayments.filter((p) => p.direction === "received")} /> : String(row.displayName);
    },
  },
  { key: "company", label: "Company" },
  {
    key: "creditBalance",
    label: "We Owe",
    align: "right",
    render: (row) => {
      const balance = byRowId.get(String(row.id));
      if (!balance || balance.recentPurchases.length === 0) return String(row.creditBalance);
      return <LedgerDocHover docs={balance.recentPurchases} trigger={String(row.creditBalance)} />;
    },
  },
  {
    key: "debtBalance",
    label: "Owes Us",
    align: "right",
    render: (row) => {
      const balance = byRowId.get(String(row.id));
      if (!balance || balance.recentInvoices.length === 0) return String(row.debtBalance);
      return <LedgerDocHover docs={balance.recentInvoices} trigger={String(row.debtBalance)} />;
    },
  },
];

// Sent to the contact to be checked against their own book, so it goes out one
// contact at a time rather than as a page of everybody's balances.
const statementColumn = (byRowId: Map<string, ContactLedgerBalance>, buttons: (contact: ContactLedgerBalance) => ReactNode): ColumnDef => ({
  key: "statement",
  label: "Statement",
  render: (row) => {
    const balance = byRowId.get(String(row.id));
    return balance ? <div className="flex gap-1.5">{buttons(balance)}</div> : null;
  },
});

type Option = { id: string; name: string };
type ScopedOption = Option & { companyId: string };
type ModalState = { kind: "add" } | { kind: "edit"; balance: ContactLedgerBalance } | null;

export function LedgerManager({
  balances,
  companyOptions,
  contactOptions,
  letterhead,
  filter,
}: {
  balances: ContactLedgerBalance[];
  companyOptions: Option[];
  contactOptions: ScopedOption[];
  // Whose name goes at the top of anything printed from here. One name, not the
  // internal company a balance is booked under — the same reasoning the invoice
  // generator states at INVOICE_COMPANY_NAME.
  letterhead: Letterhead;
  // The company filter, built by the page — it drives a query param, so the
  // filtering happens up there rather than over the rows already handed down.
  filter?: React.ReactNode;
}) {
  const [modal, setModal] = useState<ModalState>(null);
  // Whose statement is being taken, and as what. Null except for the moment the
  // document is mounted off-screen and photographed.
  const [sheet, setSheet] = useState<{ format: "pdf" | "png"; contact: ContactLedgerBalance } | null>(null);
  const [sheetError, setSheetError] = useState<string | null>(null);
  // Above the off-screen copy rather than inside it: development mounts that
  // copy twice, and each mount is its own component with its own refs.
  const capturing = useRef(false);

  async function captureSheet(node: HTMLElement) {
    if (!sheet || capturing.current) return;
    capturing.current = true;
    setSheetError(null);
    // Named for what it is, so a folder of these is readable: the contact and
    // the date it was taken.
    const who = sheet.contact.displayName.replace(/[^a-zA-Z0-9._-]+/g, "-");
    const fileName = `${who}-statement-${todayISO()}.${sheet.format}`;
    try {
      if (sheet.format === "pdf") await downloadNodeAsPdf(node, fileName);
      else await downloadNodeAsPng(node, fileName);
    } catch {
      // Drawing the page into an image is the browser's job and it can decline.
      // Said out loud rather than swallowed: a button that quietly does nothing
      // is the worst version of this, and it is the version that shipped first.
      setSheetError("Couldn't build that file. Try again, or use the browser's print dialog.");
    } finally {
      capturing.current = false;
      setSheet(null);
    }
  }

  // A statement goes out one contact at a time, so these live on the row rather
  // than in the header.
  const downloadButtons = (contact: ContactLedgerBalance, className: string) =>
    (["pdf", "png"] as const).map((format) => (
      <button
        key={format}
        type="button"
        title={`Download ${contact.displayName}'s statement as ${format.toUpperCase()}`}
        aria-label={`Download ${contact.displayName} statement as ${format.toUpperCase()}`}
        disabled={sheet !== null}
        // Both stopped: the cell opens the contact's row on click, and the row
        // takes the highlight on mousedown. Neither should fire for this button.
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          setSheet({ format, contact });
        }}
        className={className}
      >
        {sheet?.format === format && sheet.contact.contactId === contact.contactId ? "…" : format.toUpperCase()}
      </button>
    ));

  function close() {
    setModal(null);
  }

  const byRowId = new Map(balances.map((b) => [`${b.companyId}:${b.contactId}`, b]));
  const columns = [
    ...buildColumns(byRowId),
    statementColumn(byRowId, (contact) =>
      downloadButtons(contact, "rounded border border-sand px-2 py-1 text-xs font-medium text-navy-800 hover:bg-ivory disabled:opacity-40"),
    ),
  ];

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

  useNewEntry(() => setModal({ kind: "add" }));

  return (
    <div className="flex h-full flex-col gap-2">
      <PageHeader title="Ledger" subtitle={`${balances.length} contact(s) with ledger activity`}>
        {filter}
        <button
          type="button"
          onClick={() => setModal({ kind: "add" })}
          className={primaryIconButtonClass}
          aria-label="Add ledger entry"
          title="Add ledger entry — Alt+N"
        >
          <Icon name="plus" />
        </button>
      </PageHeader>

      {sheetError && <p className="shrink-0 text-sm text-error">{sheetError}</p>}

      {sheet && (
        <SheetRenderer onReady={(node) => void captureSheet(node)}>
          <ContactStatementDocument company={letterhead} row={sheet.contact} />
        </SheetRenderer>
      )}

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
  // One id per open form: sent with every submit, claimed by the server inside
  // the same transaction as the entry, so a replayed submit can't post twice.
  const [operationId] = useState(() => crypto.randomUUID());
  // Wrapped so a transport failure (response lost after the server committed)
  // becomes an inline error instead of throwing into the error boundary — the
  // form stays, and a replayed Save is refused server-side as a duplicate.
  const [state, action, pending] = useActionState(
    async (prev: { error?: string; success?: boolean; id?: string } | undefined, formData: FormData) => {
      try {
        return isEdit ? await setContactBalance(balance.companyId, balance.contactId, prev, formData) : await createLedgerEntry(prev, formData);
      } catch {
        return { error: TRANSPORT_ERROR_MESSAGE };
      }
    },
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
      <input type="hidden" name="operationId" value={operationId} />
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
            min="0.1"
            step="0.1"
            required
            defaultValue={balance ? Math.abs(balance.balance).toFixed(1) : undefined}
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
