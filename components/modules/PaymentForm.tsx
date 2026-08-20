"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import {
  updatePayment,
  deletePayment,
  createPaymentsBatch,
  type PaymentDirection,
  type PaymentType,
  type PaymentBatchRow,
} from "@/lib/actions/payments";
import type { SettlementType } from "@/lib/actions/settlement";
import { ComboBox } from "@/components/ui/ComboBox";
import { BatchAddDialog, batchCellClass, batchInputClass } from "@/components/ui/BatchAddDialog";
import {
  inputClass,
  labelClass,
  labelTextClass,
  submitClass,
  deleteButtonClass,
  errorTextClass,
  successTextClass,
} from "@/components/ui/form-styles";
import { DateField } from "@/components/ui/DateField";
import { todayISO, money } from "@/lib/format";
import { inCompany } from "@/lib/contact-scope";
import { useClientUserId } from "@/lib/client-user";
import { useSync } from "@/components/layout/SyncProvider";
import { ChequeQuickAddButton, chequeDialogOptions } from "@/components/modules/AccountForms";
import { settlingCompanyId, type ContactBalanceHint } from "@/lib/payment-constants";

type Option = { id: string; name: string };
type ScopedOption = Option & { companyId: string };
export type ChequeOption = Option & { companyId: string | null };
// Cash accounts carry their default flag so a new row can preselect the drawer,
// and their company so a row only offers the drawers that company actually has.
export type CashOption = Option & { isDefault: boolean; companyId: string | null };
// Bank accounts carry their company (null = global) — the cheque quick-add needs
// it to narrow its own bank picker.
export type BankOption = Option & { companyId: string | null };

interface PaymentValues {
  companyId: string;
  contactId: string | null;
  amount: string;
  paymentDate: string;
  paymentType: PaymentType | null;
  bankAccountId: string | null;
  cashAccountId: string | null;
  chequeId: string | null;
}

const PAYMENT_TYPES: { value: PaymentType; label: string }[] = [
  { value: "account", label: "Account" },
  { value: "cash", label: "Cash" },
  { value: "cheque", label: "Cheque" },
];

// --- Batch add ------------------------------------------------------------

// Contact is typed, not picked from a fixed list — an unrecognised name becomes a
// new contact for that company on save (resolve-refs.ts), so there's no separate
// "add contact" step.
type PaymentBatchRowLocal = {
  direction: PaymentDirection;
  companyId: string;
  contactId: string;
  contactText: string;
  settlementType: SettlementType;
  settlementId: string;
  amount: string;
};

// The one mapping from an editable row to what the server action accepts, used
// by both the live submit and the offline queue — the queued payload must be
// byte-for-byte the same shape createPaymentsBatch reads.
function toServerRows(rows: PaymentBatchRowLocal[], batchDate: string): PaymentBatchRow[] {
  return rows.map((r) => ({
    direction: r.direction,
    companyId: r.companyId,
    contactId: r.contactId || null,
    contactName: r.contactText.trim() || null,
    settlementType: r.settlementType,
    bankAccountId: r.settlementType === "account" ? r.settlementId || null : null,
    cashAccountId: r.settlementType === "cash" ? r.settlementId || null : null,
    chequeId: r.settlementType === "cheque" ? r.settlementId || null : null,
    // Left blank rather than defaulted to "0" — that's how the server tells
    // an untouched spare row from one someone actually typed a number into.
    amount: r.amount.trim(),
    // One date at the top of the dialog, saved on every row.
    paymentDate: batchDate,
  }));
}

export function PaymentBatchAddDialog({
  companyOptions,
  contactOptions,
  contactBalances,
  bankAccountOptions,
  cashAccountOptions,
  chequeOptions,
  onClose,
  onDone,
}: {
  companyOptions: Option[];
  contactOptions: ScopedOption[];
  // What each contact's ledger stands at, per company — what tells a receipt
  // which set of books the receivable it settles is in. See settlingCompanyId.
  contactBalances: ContactBalanceHint[];
  bankAccountOptions: BankOption[];
  cashAccountOptions: CashOption[];
  chequeOptions: ChequeOption[];
  onClose: () => void;
  onDone: () => void;
}) {
  const defaultCompanyId = companyOptions[0]?.id ?? "";

  // Picking a contact (or flipping the direction) moves the row to the company
  // where that contact's balance is on the side this payment settles — the whole
  // point of the row is to clear something, and it can only clear what's in the
  // same books. Silent when the contact owes on both sides, or on neither.
  //
  // The account is fixed up in the same pass: moving a row to another company —
  // by hand or by the rule above — leaves it pointing at an account that company
  // hasn't got, and a picker that no longer lists it shows a blank while the row
  // still carries the id.
  const settledIn = (row: PaymentBatchRowLocal, patch: Partial<PaymentBatchRowLocal>): Partial<PaymentBatchRowLocal> => {
    const next = { ...row, ...patch };
    const companyId = (next.contactId && settlingCompanyId(contactBalances, next.contactId, next.direction)) || next.companyId;
    const options = settlementList(next.settlementType, companyId);
    const settlementId = options.some((o) => o.id === next.settlementId)
      ? next.settlementId
      : next.settlementType === "cash"
        ? drawerFor(companyId)
        : "";
    return { ...patch, companyId, settlementId };
  };

  // Cheques created from a row's "+" join the shared list, so they're pickable
  // from every row — and the row that opened the dialog gets the first one
  // selected, which is what it was opened for.
  const [chequeOpts, setChequeOpts] = useState(chequeOptions);
  // One operation id per dialog session: every submit of this batch posts under
  // the same id, so a response lost after a successful save can't post the batch
  // a second time when the user clicks Save again. Fresh mount = fresh id = a
  // genuinely new batch.
  // The batch draft is scoped per user (payment-batch:<uid>) so a shared
  // browser never offers one user's half-typed rows to another.
  const userId = useClientUserId();
  const [operationId] = useState(() => crypto.randomUUID());
  const { enqueue } = useSync();
  // An account belongs to one company (or to none, which means all of them), and
  // money moves within one set of books — so a row offers that company's
  // accounts and the global ones, nothing else.
  const settlementList = (type: SettlementType, companyId: string) =>
    (type === "account" ? bankAccountOptions : type === "cash" ? cashAccountOptions : chequeOpts).filter(inCompany(companyId));

  // Payments are nearly always made out of the drawer, on the day they happen, so
  // that's where a fresh row starts. Which cash account is "the drawer" comes from
  // cash_accounts.is_default, not a name match. One date at the top of the dialog
  // covers the whole batch — there is no per-row date to retype. en-CA is the
  // YYYY-MM-DD the date input wants, in local time — toISOString() would hand
  // back yesterday for anything entered before 05:00 here.
  const today = new Date().toLocaleDateString("en-CA");
  const [batchDate, setBatchDate] = useState(today);
  // The drawer of the company the row starts in — the default account of another
  // company isn't offered by the picker, so it can't be what a row starts on.
  const drawerFor = (companyId: string) => {
    const drawers = cashAccountOptions.filter(inCompany(companyId));
    return drawers.find((a) => a.isDefault)?.id ?? drawers[0]?.id ?? "";
  };
  const defaultCashId = drawerFor(defaultCompanyId);

  const emptyRow = (): PaymentBatchRowLocal => ({
    direction: "made",
    companyId: defaultCompanyId,
    contactId: "",
    contactText: "",
    settlementType: "cash",
    settlementId: defaultCashId,
    amount: "",
  });

  return (
    // A batch of payments is exactly the work a crash must not cost — the rows
    // are drafted as they're typed and offered back on reopen. (The date at the
    // top isn't drafted; it restarts on today.)
    <BatchAddDialog<PaymentBatchRowLocal>
      title="Add Payments"
      onClose={onClose}
      onDone={onDone}
      emptyRow={emptyRow}
      initialRows={1}
      autoAppend
      draftKey={userId ? `payment-batch:${userId}` : "payment-batch"}
      headers={["Direction", "Contact", "Amount", "Settle via", "Account", "Company"]}
      toolbar={
        <label className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-steel">Date</span>
          <span className="w-44 rounded border border-sand">
            <DateField value={batchDate} onChange={setBatchDate} className={batchInputClass} />
          </span>
        </label>
      }
      onSubmit={async (rows) => {
        return createPaymentsBatch(toServerRows(rows, batchDate), operationId);
      }}
      onQueue={(rows) => {
        const values = toServerRows(rows, batchDate);
        // The stable operation id is minted here, inside the queue — a replayed
        // sync after a lost response is refused server-side, never doubled.
        // Returns whether the queue actually persisted: when the browser could
        // not write it, the dialog stays open with its rows instead of closing
        // as if the work were safe.
        return enqueue("payment", `${values.length} payment(s) · ${money(values.reduce((s, r) => s + Number(r.amount || 0), 0))}`, values)?.persisted ?? false;
      }}
      renderRow={(row, _index, update) => (
        <>
          {/* 1. Direction */}
          <td className={batchCellClass}>
            <select
              value={row.direction}
              onChange={(e) => update(settledIn(row, { direction: e.target.value as PaymentDirection }))}
              className={batchInputClass}
            >
              <option value="received">Received</option>
              <option value="made">Made</option>
            </select>
          </td>
          {/* 2. Contact */}
          <td className={batchCellClass}>
            <ComboBox
              value={row.contactText}
              options={contactOptions.filter(inCompany(row.companyId))}
              placeholder="Pick or type a new one"
              className={batchInputClass}
              onChange={(name) =>
                update(
                  settledIn(row, {
                    contactText: name,
                    contactId: contactOptions.find((c) => inCompany(row.companyId)(c) && c.name === name)?.id ?? "",
                  }),
                )
              }
            />
          </td>
          {/* 3. Amount */}
          <td className={batchCellClass}>
            {/* A cheque settles for its own registered amount, so the field is
                disabled for cheque rows — the server reads the amount off the
                cheque. */}
            <input
              type="number"
              min="0.1"
              step="0.1"
              value={row.settlementType === "cheque" ? "" : row.amount}
              disabled={row.settlementType === "cheque"}
              placeholder={row.settlementType === "cheque" ? "from cheque" : ""}
              onChange={(e) => update({ amount: e.target.value })}
              className={`${batchInputClass} disabled:bg-ivory disabled:text-steel`}
            />
          </td>
          {/* 4. Settle via */}
          <td className={batchCellClass}>
            <select
              value={row.settlementType}
              onChange={(e) => update(settledIn(row, { settlementType: e.target.value as SettlementType, settlementId: "" }))}
              className={batchInputClass}
            >
              <option value="account">Account</option>
              <option value="cash">Cash</option>
              <option value="cheque">Cheque</option>
            </select>
          </td>
          {/* 5. Account */}
          <td className={batchCellClass}>
            {/* Settling by cheque needs the cheque to exist in the register, so
                a cheque row gets a "+" that puts one there without leaving the
                batch half-entered. */}
            <div className="flex gap-1.5">
              <select value={row.settlementId} onChange={(e) => update({ settlementId: e.target.value })} className={batchInputClass}>
                <option value="">—</option>
                {settlementList(row.settlementType, row.companyId).map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
              {row.settlementType === "cheque" && (
                <ChequeQuickAddButton
                  companyOptions={companyOptions}
                  {...chequeDialogOptions(contactOptions, bankAccountOptions)}
                  onCreated={(created) => {
                    setChequeOpts((prev) => [...created, ...prev]);
                    if (created[0]?.companyId === row.companyId) update({ settlementId: created[0].id });
                  }}
                />
              )}
            </div>
          </td>
          {/* 6. Company */}
          <td className={batchCellClass}>
            <select
              value={row.companyId}
              onChange={(e) => {
                // A contact belongs to one company, so switching companies drops
                // the picked id — the text stays and re-resolves against the new
                // company's list on save.
                const stillValid = contactOptions.some((c) => c.id === row.contactId && inCompany(e.target.value)(c));
                const patch = { companyId: e.target.value, ...(stillValid ? {} : { contactId: "" }) };
                // Chosen by hand, so the contact's own balance doesn't get to
                // overrule it — only the account is re-pointed at this company.
                update({ ...patch, ...settledIn({ ...row, contactId: "" }, patch) });
              }}
              className={batchInputClass}
            >
              <option value="" disabled>
                Select
              </option>
              {companyOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </td>
        </>
      )}
    />
  );
}

function Fields({
  defaults,
  companyOptions,
  contactOptions,
  contactId,
  contactText,
  onContactChange,
  bankAccountOptions,
  cashAccountOptions,
  chequeOptions,
}: {
  defaults?: PaymentValues;
  companyOptions: Option[];
  contactOptions: ScopedOption[];
  contactId: string;
  contactText: string;
  onContactChange: (id: string, text: string) => void;
  bankAccountOptions: BankOption[];
  cashAccountOptions: CashOption[];
  chequeOptions: ChequeOption[];
}) {
  const [paymentType, setPaymentType] = useState<PaymentType>(defaults?.paymentType ?? "cash");
  const [companyId, setCompanyId] = useState(defaults?.companyId ?? "");
  // The chosen company's contacts, plus the global ones — a contact with no
  // company is visible to every company.
  const visibleContacts = useMemo(() => contactOptions.filter(inCompany(companyId)), [contactOptions, companyId]);
  // Cheques created from the "+" beside the picker, newest first.
  const [chequeOpts, setChequeOpts] = useState(chequeOptions);
  // This company's accounts and the global ones, same rule as the batch grid:
  // an account belongs to one set of books and money moves within one.
  const settlementOptions = (paymentType === "account" ? bankAccountOptions : paymentType === "cash" ? cashAccountOptions : chequeOpts).filter(
    inCompany(companyId),
  );
  const settlementFieldName = paymentType === "account" ? "bankAccountId" : paymentType === "cash" ? "cashAccountId" : "chequeId";
  const settlementDefault =
    paymentType === "account" ? defaults?.bankAccountId : paymentType === "cash" ? defaults?.cashAccountId : defaults?.chequeId;
  // The select is uncontrolled (it remounts on `key` when the settlement type
  // changes, taking a fresh default with it), so a cheque created on the spot is
  // selected by overriding that default rather than by holding a value.
  const [createdChequeId, setCreatedChequeId] = useState("");

  return (
    <>
      <label className={labelClass}>
        <span className={labelTextClass}>Company</span>
        <select
          name="companyId"
          required
          value={companyId}
          onChange={(e) => {
            setCompanyId(e.target.value);
            // Drop a contact that doesn't belong to the newly chosen company —
            // the typed text stays and re-resolves against the new company.
            if (contactId && !contactOptions.some((c) => c.id === contactId && c.companyId === e.target.value)) onContactChange("", contactText);
          }}
          className={inputClass}
        >
          <option value="" disabled>
            {companyOptions.length === 0 ? "No companies yet — create one first" : "Select a company"}
          </option>
          {companyOptions.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      {/* Typed, not picked: an unrecognised name becomes a new contact for this
          company on save, the same way a sale creates a customer. */}
      <div className={labelClass}>
        <span className={labelTextClass}>Contact</span>
        <ComboBox
          value={contactText}
          options={visibleContacts}
          placeholder="Pick a contact or type a new one"
          className={inputClass}
          onChange={(name) => onContactChange(visibleContacts.find((c) => c.name === name)?.id ?? "", name)}
        />
        <input type="hidden" name="contactId" value={contactId} />
        <input type="hidden" name="contactName" value={contactText} />
      </div>
      <label className={labelClass}>
        <span className={labelTextClass}>Date</span>
        <DateField name="paymentDate" required defaultValue={defaults?.paymentDate ?? todayISO()} className={inputClass} />
      </label>
      <div className={labelClass}>
        <span className={labelTextClass}>Settle via</span>
        <div className="flex gap-2">
          {PAYMENT_TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setPaymentType(t.value)}
              className={`h-11 flex-1 rounded border text-sm font-semibold ${
                paymentType === t.value ? "border-navy-800 bg-navy-800 text-white" : "border-sand text-steel hover:bg-ivory"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <input type="hidden" name="paymentType" value={paymentType} />
      <div className={labelClass}>
        <span className={labelTextClass}>{paymentType === "account" ? "Account" : paymentType === "cash" ? "Cash Account" : "Cheque"}</span>
        <div className="flex gap-1.5">
          <select
            key={`${paymentType}:${companyId}:${createdChequeId}`}
            name={settlementFieldName}
            required
            defaultValue={createdChequeId || settlementDefault || ""}
            className={inputClass}
          >
            <option value="" disabled>
              {settlementOptions.length === 0 ? "None available — create one first" : "Select"}
            </option>
            {settlementOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          {/* Settling by cheque needs the cheque to exist in the register — this
              puts one there without abandoning the payment being filled in. */}
          {paymentType === "cheque" && (
            <ChequeQuickAddButton
              companyOptions={companyOptions}
              {...chequeDialogOptions(contactOptions, bankAccountOptions)}
              onCreated={(created) => {
                setChequeOpts((prev) => [...created, ...prev]);
                if (created[0]?.companyId === companyId) setCreatedChequeId(created[0].id);
              }}
            />
          )}
        </div>
      </div>
      {paymentType !== "cheque" && (
        <label className={labelClass}>
          <span className={labelTextClass}>Amount</span>
          <input name="amount" type="number" step="0.1" min="0.1" required defaultValue={defaults?.amount} className={inputClass} />
        </label>
      )}
    </>
  );
}

export function PaymentEditForm({
  paymentId,
  direction,
  defaults,
  companyOptions,
  contactOptions,
  bankAccountOptions,
  cashAccountOptions,
  chequeOptions,
  onDone,
}: {
  paymentId: string;
  direction: PaymentDirection;
  defaults: PaymentValues;
  companyOptions: Option[];
  contactOptions: ScopedOption[];
  bankAccountOptions: BankOption[];
  cashAccountOptions: CashOption[];
  chequeOptions: ChequeOption[];
  onDone?: () => void;
}) {
  const [state, action, pending] = useActionState(updatePayment.bind(null, paymentId), undefined);
  const [contactId, setContactId] = useState(defaults.contactId ?? "");
  const [contactText, setContactText] = useState(() => contactOptions.find((c) => c.id === defaults.contactId)?.name ?? "");

  useEffect(() => {
    if (state?.success) onDone?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.success]);

  return (
    <form action={action} className="flex flex-col gap-4">
      <div className={labelClass}>
        <span className={labelTextClass}>Direction</span>
        <p className="text-sm text-ink">{direction === "made" ? "Payment Made" : "Payment Received"} (fixed after creation)</p>
      </div>
      <Fields
        defaults={defaults}
        companyOptions={companyOptions}
        contactOptions={contactOptions}
        contactId={contactId}
        contactText={contactText}
        onContactChange={(id, text) => {
          setContactId(id);
          setContactText(text);
        }}
        bankAccountOptions={bankAccountOptions}
        cashAccountOptions={cashAccountOptions}
        chequeOptions={chequeOptions}
      />
      {state?.error && <p className={errorTextClass}>{state.error}</p>}
      {state?.success && <p className={successTextClass}>Saved.</p>}
      <button type="submit" disabled={pending} className={submitClass}>
        {pending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}

export function DeletePaymentButton({ paymentId, onDone }: { paymentId: string; onDone?: () => void }) {
  const [state, action, pending] = useActionState(deletePayment, undefined);

  useEffect(() => {
    if (state?.success) onDone?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.success]);

  return (
    <form action={action} onSubmit={(e) => { if (!confirm("Cancel this payment? Its history will remain and FIFO settlements will be recalculated.")) e.preventDefault(); }}>
      <input type="hidden" name="paymentId" value={paymentId} />
      <button type="submit" disabled={pending} className={deleteButtonClass}>
        {pending ? "Cancelling…" : "Cancel this payment"}
      </button>
      {state?.error && <p className={`mt-2 ${errorTextClass}`}>{state.error}</p>}
    </form>
  );
}
