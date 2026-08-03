"use client";

import { useActionState, useEffect, useState } from "react";
import { updateExpense, deleteExpense, createExpensesBatch, type ExpenseBatchRow } from "@/lib/actions/expenses";
import type { SettlementType } from "@/lib/actions/settlement";
import { ComboBox } from "@/components/ui/ComboBox";
import { BatchAddDialog, batchCellClass, batchInputClass } from "@/components/ui/BatchAddDialog";
import { inputClass, labelClass, labelTextClass, submitClass, deleteButtonClass, errorTextClass, successTextClass } from "@/components/ui/form-styles";
import { DateField } from "@/components/ui/DateField";
import { todayISO } from "@/lib/format";
import { ChequeQuickAddButton } from "@/components/modules/AccountForms";

type Option = { id: string; name: string };
type ScopedOption = Option & { companyId: string };
// Cash accounts carry their default flag so a new row can preselect the drawer.
export type CashOption = Option & { isDefault: boolean };
// Bank accounts carry their company (null = global) — the cheque quick-add needs
// it to narrow its own bank picker.
export type BankOption = Option & { companyId: string | null };

// The cheque dialog names contacts and bank accounts its own way; this is the
// one place that translation lives.
const forChequeDialog = (contactOptions: ScopedOption[], bankAccountOptions: BankOption[]) => ({
  contactOptions: contactOptions.map((c) => ({ id: c.id, displayName: c.name, companyId: c.companyId || null })),
  bankAccountOptions: bankAccountOptions.map((b) => ({ id: b.id, label: b.name, companyId: b.companyId })),
});

interface ExpenseValues {
  companyId: string;
  expenseCategoryId: string;
  bankAccountId: string | null;
  cashAccountId: string | null;
  chequeId: string | null;
  amount: string;
  expenseDate: string;
  notes: string | null;
  attachmentUrl: string | null;
}

const SETTLEMENT_TYPES: { value: SettlementType; label: string }[] = [
  { value: "account", label: "Account" },
  { value: "cash", label: "Cash" },
  { value: "cheque", label: "Cheque" },
];

// --- Batch add ------------------------------------------------------------

// Category is typed, not picked from a fixed list — same as an item on a sale
// line. The id is filled in when the text matches an existing category; anything
// else is a new category created for that company on save (resolve-refs.ts), so
// there's no separate "add category" step.
type BatchRow = {
  companyId: string;
  expenseCategoryId: string;
  expenseCategoryText: string;
  settlementType: SettlementType;
  settlementId: string;
  amount: string;
  expenseDate: string;
  notes: string;
};

export function ExpenseBatchAddDialog({
  companyOptions,
  categoryOptions,
  contactOptions,
  bankAccountOptions,
  cashAccountOptions,
  chequeOptions,
  onClose,
  onDone,
}: {
  companyOptions: Option[];
  categoryOptions: ScopedOption[];
  // Only used by the cheque quick-add, which files the cheque against a party.
  contactOptions: ScopedOption[];
  bankAccountOptions: BankOption[];
  cashAccountOptions: CashOption[];
  chequeOptions: Option[];
  onClose: () => void;
  onDone: () => void;
}) {
  const defaultCompanyId = companyOptions[0]?.id ?? "";

  // Which account list a row's settlement dropdown shows depends on its
  // "Settle via" choice. Cheques created from a row's "+" join the shared list,
  // so they're pickable from every row.
  const [chequeOpts, setChequeOpts] = useState(chequeOptions);
  const settlementList = (t: SettlementType) => (t === "account" ? bankAccountOptions : t === "cash" ? cashAccountOptions : chequeOpts);

  // Expenses are almost always entered the day they happen, so every row starts
  // on today and gets typed over when it isn't. en-CA is the YYYY-MM-DD the date
  // input wants, in local time — toISOString() would hand back yesterday for
  // anything entered before 05:00 here.
  const today = new Date().toLocaleDateString("en-CA");

  // Expenses come out of the drawer far more often than out of a bank account,
  // so rows start on Cash with the account flagged default (Cash on Hand). Which
  // one that is comes from cash_accounts.is_default, not a name match — there are
  // several cash accounts and "Carton Cash" happened to sort first.
  const defaultCashId = cashAccountOptions.find((a) => a.isDefault)?.id ?? cashAccountOptions[0]?.id ?? "";

  const emptyRow = (): BatchRow => ({
    companyId: defaultCompanyId,
    expenseCategoryId: "",
    expenseCategoryText: "",
    settlementType: "cash",
    settlementId: defaultCashId,
    amount: "",
    expenseDate: today,
    notes: "",
  });

  return (
    <BatchAddDialog<BatchRow>
      title="Add Expenses"
      onClose={onClose}
      onDone={onDone}
      emptyRow={emptyRow}
      headers={["Company", "Category", "Date", "Amount", "Settle via", "Account", "Note"]}
      onSubmit={async (rows) => {
        const values: ExpenseBatchRow[] = rows.map((r) => ({
          companyId: r.companyId,
          expenseCategoryId: r.expenseCategoryId,
          expenseCategoryName: r.expenseCategoryText,
          settlementType: r.settlementType,
          bankAccountId: r.settlementType === "account" ? r.settlementId || null : null,
          cashAccountId: r.settlementType === "cash" ? r.settlementId || null : null,
          chequeId: r.settlementType === "cheque" ? r.settlementId || null : null,
          amount: r.amount.trim() || "0",
          expenseDate: r.expenseDate,
          notes: r.notes.trim() || null,
        }));
        return createExpensesBatch(values);
      }}
      renderRow={(row, i, update) => (
        <>
          <td className={batchCellClass}>
            <select
              value={row.companyId}
              onChange={(e) => {
                // A category belongs to one company, so switching companies drops
                // the picked id — the text stays and re-resolves against the new
                // company's list on save.
                const stillValid = categoryOptions.some((c) => c.id === row.expenseCategoryId && c.companyId === e.target.value);
                update({ companyId: e.target.value, ...(stillValid ? {} : { expenseCategoryId: "" }) });
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
          <td className={batchCellClass}>
            <ComboBox
              value={row.expenseCategoryText}
              options={categoryOptions.filter((c) => c.companyId === row.companyId)}
              placeholder="Fuel, Rent…"
              className={batchInputClass}
              onChange={(name) =>
                update({
                  expenseCategoryText: name,
                  expenseCategoryId: categoryOptions.find((c) => c.companyId === row.companyId && c.name === name)?.id ?? "",
                })
              }
            />
          </td>
          <td className={batchCellClass}>
            <DateField value={row.expenseDate} onChange={(expenseDate) => update({ expenseDate })} className={batchInputClass} />
          </td>
          <td className={batchCellClass}>
            <input type="number" step="0.01" value={row.amount} onChange={(e) => update({ amount: e.target.value })} className={batchInputClass} />
          </td>
          <td className={batchCellClass}>
            {/* Changing settle-via clears the picked account, since the old id
                belongs to a different list. */}
            <select
              value={row.settlementType}
              onChange={(e) => update({ settlementType: e.target.value as SettlementType, settlementId: "" })}
              className={batchInputClass}
            >
              <option value="account">Account</option>
              <option value="cash">Cash</option>
              <option value="cheque">Cheque</option>
            </select>
          </td>
          <td className={batchCellClass}>
            {/* Settling by cheque needs the cheque to exist in the register, so
                a cheque row gets a "+" that puts one there without leaving the
                batch half-entered. */}
            <div className="flex gap-1.5">
              <select value={row.settlementId} onChange={(e) => update({ settlementId: e.target.value })} className={batchInputClass}>
                <option value="">—</option>
                {settlementList(row.settlementType).map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
              {row.settlementType === "cheque" && (
                <ChequeQuickAddButton
                  companyOptions={companyOptions}
                  {...forChequeDialog(contactOptions, bankAccountOptions)}
                  onCreated={(created) => {
                    setChequeOpts((prev) => [...created, ...prev]);
                    update({ settlementId: created[0].id });
                  }}
                />
              )}
            </div>
          </td>
          <td className={batchCellClass}>
            <input value={row.notes} onChange={(e) => update({ notes: e.target.value })} className={batchInputClass} />
          </td>
        </>
      )}
    />
  );
}

// Category references a record the user might not have yet, so it gets a "+".
// Settlement accounts (bank/cash/cheque) are created on the Accounts page and
// picked here; adding those inline is out of scope for now.
function Fields({
  defaults,
  companyOptions,
  categoryOptions,
  contactOptions,
  bankAccountOptions,
  cashAccountOptions,
  chequeOptions,
}: {
  defaults?: ExpenseValues;
  companyOptions: Option[];
  categoryOptions: ScopedOption[];
  // Only used by the cheque quick-add, which files the cheque against a party.
  contactOptions: ScopedOption[];
  bankAccountOptions: BankOption[];
  cashAccountOptions: CashOption[];
  chequeOptions: Option[];
}) {
  const [companyId, setCompanyId] = useState(defaults?.companyId ?? companyOptions[0]?.id ?? "");
  const [expenseCategoryId, setExpenseCategoryId] = useState(defaults?.expenseCategoryId ?? "");
  const [categoryText, setCategoryText] = useState(() => categoryOptions.find((c) => c.id === defaults?.expenseCategoryId)?.name ?? "");
  const [settlementType, setSettlementType] = useState<SettlementType>(
    defaults?.bankAccountId ? "account" : defaults?.cashAccountId ? "cash" : defaults?.chequeId ? "cheque" : "cash",
  );
  // Cheques created from the "+" beside the picker, newest first.
  const [chequeOpts, setChequeOpts] = useState(chequeOptions);
  const settlementOptions = settlementType === "account" ? bankAccountOptions : settlementType === "cash" ? cashAccountOptions : chequeOpts;
  const settlementFieldName = settlementType === "account" ? "bankAccountId" : settlementType === "cash" ? "cashAccountId" : "chequeId";
  const settlementDefault =
    settlementType === "account" ? defaults?.bankAccountId : settlementType === "cash" ? defaults?.cashAccountId : defaults?.chequeId;
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
            // Drop a category that doesn't belong to the newly chosen company.
            if (expenseCategoryId && !categoryOptions.some((c) => c.id === expenseCategoryId && c.companyId === e.target.value))
              setExpenseCategoryId("");
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

      {/* Typed, not picked: an unrecognised name becomes a new category for this
          company on save, the same way a sale line creates an item. */}
      <div className={labelClass}>
        <span className={labelTextClass}>Category</span>
        <ComboBox
          value={categoryText}
          options={categoryOptions.filter((c) => c.companyId === companyId)}
          placeholder="Fuel, Rent, Petty Cash…"
          className={inputClass}
          onChange={(name) => {
            setCategoryText(name);
            setExpenseCategoryId(categoryOptions.find((c) => c.companyId === companyId && c.name === name)?.id ?? "");
          }}
        />
        <input type="hidden" name="expenseCategoryId" value={expenseCategoryId} />
        <input type="hidden" name="expenseCategoryName" value={categoryText} />
      </div>

      <label className={labelClass}>
        <span className={labelTextClass}>Date</span>
        <DateField name="expenseDate" required defaultValue={defaults?.expenseDate ?? todayISO()} className={inputClass} />
      </label>
      <label className={labelClass}>
        <span className={labelTextClass}>Amount</span>
        <input name="amount" type="number" step="0.01" min="0.01" required defaultValue={defaults?.amount} className={inputClass} />
      </label>

      <div className={labelClass}>
        <span className={labelTextClass}>Settle via</span>
        <div className="flex gap-2">
          {SETTLEMENT_TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setSettlementType(t.value)}
              className={`h-11 flex-1 rounded border text-sm font-semibold ${
                settlementType === t.value ? "border-navy-800 bg-navy-800 text-white" : "border-sand text-steel hover:bg-ivory"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <input type="hidden" name="settlementType" value={settlementType} />
      <div className={labelClass}>
        <span className={labelTextClass}>{settlementType === "account" ? "Account" : settlementType === "cash" ? "Cash Account" : "Cheque"}</span>
        <div className="flex gap-1.5">
          <select
            key={`${settlementType}:${createdChequeId}`}
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
              puts one there without abandoning the expense being filled in. */}
          {settlementType === "cheque" && (
            <ChequeQuickAddButton
              companyOptions={companyOptions}
              {...forChequeDialog(contactOptions, bankAccountOptions)}
              onCreated={(created) => {
                setChequeOpts((prev) => [...created, ...prev]);
                setCreatedChequeId(created[0].id);
              }}
            />
          )}
        </div>
      </div>
      <label className={labelClass}>
        <span className={labelTextClass}>Note</span>
        <textarea name="notes" defaultValue={defaults?.notes ?? ""} className={`${inputClass} h-24 py-2`} />
      </label>
      <label className={labelClass}>
        <span className={labelTextClass}>Attachment URL</span>
        <input name="attachmentUrl" type="text" placeholder="Link to receipt photo (optional)" defaultValue={defaults?.attachmentUrl ?? ""} className={inputClass} />
      </label>
    </>
  );
}

export function ExpenseEditForm({
  expenseId,
  defaults,
  companyOptions,
  categoryOptions,
  contactOptions,
  bankAccountOptions,
  cashAccountOptions,
  chequeOptions,
  onDone,
}: {
  expenseId: string;
  defaults: ExpenseValues;
  companyOptions: Option[];
  categoryOptions: ScopedOption[];
  // Only used by the cheque quick-add, which files the cheque against a party.
  contactOptions: ScopedOption[];
  bankAccountOptions: BankOption[];
  cashAccountOptions: CashOption[];
  chequeOptions: Option[];
  onDone?: () => void;
}) {
  const [state, action, pending] = useActionState(updateExpense.bind(null, expenseId), undefined);

  useEffect(() => {
    if (state?.success) onDone?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.success]);

  return (
    <form action={action} className="flex flex-col gap-4">
      <Fields
        defaults={defaults}
        companyOptions={companyOptions}
        categoryOptions={categoryOptions}
        contactOptions={contactOptions}
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

export function DeleteExpenseButton({ expenseId, onDone }: { expenseId: string; onDone?: () => void }) {
  const [state, action, pending] = useActionState(deleteExpense, undefined);

  useEffect(() => {
    if (state?.success) onDone?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.success]);

  return (
    <form action={action} onSubmit={(e) => { if (!confirm("Delete this expense?")) e.preventDefault(); }}>
      <input type="hidden" name="expenseId" value={expenseId} />
      <button type="submit" disabled={pending} className={deleteButtonClass}>
        {pending ? "Deleting…" : "Delete this expense"}
      </button>
      {state?.error && <p className={`mt-2 ${errorTextClass}`}>{state.error}</p>}
    </form>
  );
}
