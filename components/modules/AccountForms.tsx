"use client";

import { useActionState, useEffect, useState } from "react";
import {
  updateBankAccount,
  deleteBankAccount,
  createBankAccountsBatch,
  type BankAccountBatchRow,
  updateCashAccount,
  deleteCashAccount,
  createCashAccountsBatch,
  type CashAccountBatchRow,

  updateCheque,
  deleteCheque,
  createChequesBatch,
  type ChequeBatchRow,
} from "@/lib/actions/accounts";
import { CHEQUE_TYPES, CHEQUE_STATUSES } from "@/lib/cheque-constants";
import { QuickAddButton } from "@/components/ui/QuickAddSelect";
import { quickAddButtonClass } from "@/components/ui/form-styles";
import { inputClass, labelClass, labelTextClass, submitClass, deleteButtonClass, errorTextClass, successTextClass } from "@/components/ui/form-styles";
import { DateField } from "@/components/ui/DateField";
import { ComboBox } from "@/components/ui/ComboBox";
import { todayISO } from "@/lib/format";
import { BatchAddDialog, batchCellClass, batchInputClass } from "@/components/ui/BatchAddDialog";
import { inCompany } from "@/lib/contact-scope";

type CompanyOption = { id: string; name: string };

// --- Bank account ---

export interface BankAccountValues {
  companyId: string | null;
  bankName: string;
  branchName: string | null;
  accountTitle: string;
  accountNumber: string;
  iban: string | null;
  openingBalance: string | null;
  currentBalance: string | null;
  isDefault: boolean;
  isActive: boolean;
}

function BankAccountFields({ defaults, companyOptions }: { defaults?: BankAccountValues; companyOptions: CompanyOption[] }) {
  return (
    <>
      <label className={labelClass}>
        <span className={labelTextClass}>Company</span>
        <select name="companyId" defaultValue={defaults?.companyId ?? ""} className={inputClass}>
          <option value="">— Global (all companies) —</option>
          {companyOptions.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label className={labelClass}>
        <span className={labelTextClass}>Bank name</span>
        <input name="bankName" type="text" required defaultValue={defaults?.bankName} className={inputClass} />
      </label>
      <label className={labelClass}>
        <span className={labelTextClass}>Branch</span>
        <input name="branchName" type="text" defaultValue={defaults?.branchName ?? ""} className={inputClass} />
      </label>
      <label className={labelClass}>
        <span className={labelTextClass}>Account title</span>
        <input name="accountTitle" type="text" required defaultValue={defaults?.accountTitle} className={inputClass} />
      </label>
      <label className={labelClass}>
        <span className={labelTextClass}>Account number</span>
        <input name="accountNumber" type="text" required defaultValue={defaults?.accountNumber} className={inputClass} />
      </label>
      <label className={labelClass}>
        <span className={labelTextClass}>IBAN</span>
        <input name="iban" type="text" defaultValue={defaults?.iban ?? ""} className={inputClass} />
      </label>
      {/* Both balances post as-is. They used to be hidden while editing, which
          meant every save wrote back "0" — an account edited to fix a typo lost
          its opening balance. */}
      <label className={labelClass}>
        <span className={labelTextClass}>Opening balance</span>
        <input name="openingBalance" type="number" step="0.1" defaultValue={defaults?.openingBalance ?? "0"} className={inputClass} />
      </label>
      <label className={labelClass}>
        <span className={labelTextClass}>Current balance</span>
        <input name="currentBalance" type="number" step="0.1" defaultValue={defaults?.currentBalance ?? "0"} className={inputClass} />
        <span className="text-xs text-steel">Moves on its own with payments and expenses — set it by hand only to correct a drift.</span>
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input name="isDefault" type="checkbox" defaultChecked={defaults?.isDefault ?? false} className="h-5 w-5 rounded border-sand" />
        <span className={labelTextClass}>Default account</span>
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input name="isActive" type="checkbox" defaultChecked={defaults?.isActive ?? true} className="h-5 w-5 rounded border-sand" />
        <span className={labelTextClass}>Active</span>
      </label>
    </>
  );
}

export function BankAccountEditForm({
  accountId,
  defaults,
  companyOptions,
  onDone,
}: {
  accountId: string;
  defaults: BankAccountValues;
  companyOptions: CompanyOption[];
  onDone?: () => void;
}) {
  const [state, action, pending] = useActionState(updateBankAccount.bind(null, accountId), undefined);

  useEffect(() => {
    if (state?.success) onDone?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.success]);

  return (
    <form action={action} className="flex flex-col gap-4">
      <BankAccountFields defaults={defaults} companyOptions={companyOptions} />
      {state?.error && <p className={errorTextClass}>{state.error}</p>}
      {state?.success && <p className={successTextClass}>Saved.</p>}
      <button type="submit" disabled={pending} className={submitClass}>
        {pending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}

export function DeleteBankAccountButton({ accountId, onDone }: { accountId: string; onDone?: () => void }) {
  const [state, action, pending] = useActionState(deleteBankAccount, undefined);

  useEffect(() => {
    if (state?.success) onDone?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.success]);

  return (
    <form action={action} onSubmit={(e) => { if (!confirm("Delete this bank account?")) e.preventDefault(); }}>
      <input type="hidden" name="accountId" value={accountId} />
      <button type="submit" disabled={pending} className={deleteButtonClass}>
        {pending ? "Deleting…" : "Delete this bank account"}
      </button>
      {state?.error && <p className={`mt-2 ${errorTextClass}`}>{state.error}</p>}
    </form>
  );
}

type BankBatchRow = {
  companyId: string;
  bankName: string;
  branchName: string;
  accountTitle: string;
  accountNumber: string;
  iban: string;
  openingBalance: string;
  isDefault: boolean;
  isActive: boolean;
};

const emptyBankBatchRow = (): BankBatchRow => ({
  companyId: "",
  bankName: "",
  branchName: "",
  accountTitle: "",
  accountNumber: "",
  iban: "",
  openingBalance: "0",
  isDefault: false,
  isActive: true,
});

export type CreatedBankAccount = { id: string; name: string; companyId: string | null };

export function BankAccountBatchAddDialog({
  companyOptions,
  onClose,
  onDone,
  initialRows,
}: {
  companyOptions: CompanyOption[];
  onClose: () => void;
  onDone: (created?: CreatedBankAccount[]) => void;
  initialRows?: number;
}) {
  return (
    <BatchAddDialog<BankBatchRow, CreatedBankAccount>
      title="Add Bank Accounts"
      onClose={onClose}
      onDone={onDone}
      initialRows={initialRows}
      emptyRow={emptyBankBatchRow}
      headers={["Company", "Bank Name", "Branch", "Account Title", "Account Number", "IBAN", "Opening Balance", "Default", "Active"]}
      onSubmit={async (rows) => {
        const values: BankAccountBatchRow[] = rows.map((r) => ({
          companyId: r.companyId || null,
          bankName: r.bankName.trim(),
          branchName: r.branchName.trim() || null,
          accountTitle: r.accountTitle.trim(),
          accountNumber: r.accountNumber.trim(),
          iban: r.iban.trim() || null,
          openingBalance: r.openingBalance.trim() || "0",
          isDefault: r.isDefault,
          isActive: r.isActive,
        }));
        return createBankAccountsBatch(values);
      }}
      renderRow={(row, i, update) => (
        <>
          <td className={batchCellClass}>
            <select value={row.companyId} onChange={(e) => update({ companyId: e.target.value })} className={batchInputClass}>
              <option value="">Global</option>
              {companyOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </td>
          <td className={batchCellClass}>
            <input value={row.bankName} onChange={(e) => update({ bankName: e.target.value })} className={batchInputClass} />
          </td>
          <td className={batchCellClass}>
            <input value={row.branchName} onChange={(e) => update({ branchName: e.target.value })} className={batchInputClass} />
          </td>
          <td className={batchCellClass}>
            <input value={row.accountTitle} onChange={(e) => update({ accountTitle: e.target.value })} className={batchInputClass} />
          </td>
          <td className={batchCellClass}>
            <input value={row.accountNumber} onChange={(e) => update({ accountNumber: e.target.value })} className={batchInputClass} />
          </td>
          <td className={batchCellClass}>
            <input value={row.iban} onChange={(e) => update({ iban: e.target.value })} className={batchInputClass} />
          </td>
          <td className={batchCellClass}>
            <input type="number" step="0.1" value={row.openingBalance} onChange={(e) => update({ openingBalance: e.target.value })} className={batchInputClass} />
          </td>
          <td className={`${batchCellClass} text-center`}>
            <input type="checkbox" checked={row.isDefault} onChange={(e) => update({ isDefault: e.target.checked })} className="h-5 w-5 rounded border-sand" />
          </td>
          <td className={`${batchCellClass} text-center`}>
            <input type="checkbox" checked={row.isActive} onChange={(e) => update({ isActive: e.target.checked })} className="h-5 w-5 rounded border-sand" />
          </td>
        </>
      )}
    />
  );
}

// --- Cash account ---

export interface CashAccountValues {
  companyId: string;
  name: string;
  openingBalance: string | null;
  currentBalance: string | null;
  isDefault: boolean;
  isActive: boolean;
}

function CashAccountFields({ defaults, companyOptions }: { defaults?: CashAccountValues; companyOptions: CompanyOption[] }) {
  return (
    <>
      <label className={labelClass}>
        <span className={labelTextClass}>Company</span>
        <select name="companyId" required defaultValue={defaults?.companyId} className={inputClass}>
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
      <label className={labelClass}>
        <span className={labelTextClass}>Name</span>
        <input name="name" type="text" required placeholder="Cash in Hand" defaultValue={defaults?.name} className={inputClass} />
      </label>
      {/* Same as bank accounts: both balances post, so an edit can't blank them. */}
      <label className={labelClass}>
        <span className={labelTextClass}>Opening balance</span>
        <input name="openingBalance" type="number" step="0.1" defaultValue={defaults?.openingBalance ?? "0"} className={inputClass} />
      </label>
      <label className={labelClass}>
        <span className={labelTextClass}>Current balance</span>
        <input name="currentBalance" type="number" step="0.1" defaultValue={defaults?.currentBalance ?? "0"} className={inputClass} />
        <span className="text-xs text-steel">Moves on its own with payments and expenses — set it by hand only to correct a drift.</span>
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input name="isDefault" type="checkbox" defaultChecked={defaults?.isDefault ?? false} className="h-5 w-5 rounded border-sand" />
        <span className={labelTextClass}>Default account</span>
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input name="isActive" type="checkbox" defaultChecked={defaults?.isActive ?? true} className="h-5 w-5 rounded border-sand" />
        <span className={labelTextClass}>Active</span>
      </label>
    </>
  );
}

export function CashAccountEditForm({
  accountId,
  defaults,
  companyOptions,
  onDone,
}: {
  accountId: string;
  defaults: CashAccountValues;
  companyOptions: CompanyOption[];
  onDone?: () => void;
}) {
  const [state, action, pending] = useActionState(updateCashAccount.bind(null, accountId), undefined);

  useEffect(() => {
    if (state?.success) onDone?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.success]);

  return (
    <form action={action} className="flex flex-col gap-4">
      <CashAccountFields defaults={defaults} companyOptions={companyOptions} />
      {state?.error && <p className={errorTextClass}>{state.error}</p>}
      {state?.success && <p className={successTextClass}>Saved.</p>}
      <button type="submit" disabled={pending} className={submitClass}>
        {pending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}

export function DeleteCashAccountButton({ accountId, onDone }: { accountId: string; onDone?: () => void }) {
  const [state, action, pending] = useActionState(deleteCashAccount, undefined);

  useEffect(() => {
    if (state?.success) onDone?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.success]);

  return (
    <form action={action} onSubmit={(e) => { if (!confirm("Delete this cash account?")) e.preventDefault(); }}>
      <input type="hidden" name="accountId" value={accountId} />
      <button type="submit" disabled={pending} className={deleteButtonClass}>
        {pending ? "Deleting…" : "Delete this cash account"}
      </button>
      {state?.error && <p className={`mt-2 ${errorTextClass}`}>{state.error}</p>}
    </form>
  );
}

type CashBatchRow = { companyId: string; name: string; openingBalance: string; isDefault: boolean; isActive: boolean };

const emptyCashBatchRow = (defaultCompanyId: string): CashBatchRow => ({
  companyId: defaultCompanyId,
  name: "",
  openingBalance: "0",
  isDefault: false,
  isActive: true,
});

export function CashAccountBatchAddDialog({
  companyOptions,
  onClose,
  onDone,
  initialRows,
}: {
  companyOptions: CompanyOption[];
  onClose: () => void;
  onDone: () => void;
  initialRows?: number;
}) {
  const defaultCompanyId = companyOptions[0]?.id ?? "";

  return (
    <BatchAddDialog<CashBatchRow>
      title="Add Cash Accounts"
      onClose={onClose}
      onDone={onDone}
      initialRows={initialRows}
      emptyRow={() => emptyCashBatchRow(defaultCompanyId)}
      headers={["Company", "Name", "Opening Balance", "Default", "Active"]}
      onSubmit={async (rows) => {
        const values: CashAccountBatchRow[] = rows.map((r) => ({
          companyId: r.companyId,
          name: r.name.trim(),
          openingBalance: r.openingBalance.trim() || "0",
          isDefault: r.isDefault,
          isActive: r.isActive,
        }));
        return createCashAccountsBatch(values);
      }}
      renderRow={(row, i, update) => (
        <>
          <td className={batchCellClass}>
            <select value={row.companyId} onChange={(e) => update({ companyId: e.target.value })} className={batchInputClass}>
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
            <input value={row.name} onChange={(e) => update({ name: e.target.value })} className={batchInputClass} placeholder="Cash in Hand" />
          </td>
          <td className={batchCellClass}>
            <input type="number" step="0.1" value={row.openingBalance} onChange={(e) => update({ openingBalance: e.target.value })} className={batchInputClass} />
          </td>
          <td className={`${batchCellClass} text-center`}>
            <input type="checkbox" checked={row.isDefault} onChange={(e) => update({ isDefault: e.target.checked })} className="h-5 w-5 rounded border-sand" />
          </td>
          <td className={`${batchCellClass} text-center`}>
            <input type="checkbox" checked={row.isActive} onChange={(e) => update({ isActive: e.target.checked })} className="h-5 w-5 rounded border-sand" />
          </td>
        </>
      )}
    />
  );
}

// --- Cheque ---

export interface ChequeValues {
  companyId: string;
  bankAccountId: string | null;
  contactId: string | null;
  chequeNumber: string;
  chequeDate: string;
  amount: string;
  chequeType: string;
  status: string;
  issuedByCompany: boolean;
  remarks: string | null;
}

function ChequeFields({
  defaults,
  companyOptions,
  bankAccountOptions,
  contactOptions,
}: {
  defaults?: ChequeValues;
  companyOptions: CompanyOption[];
  // companyId rides along so the pickers can drop the accounts the chosen
  // company can't see — null means global, visible to every company.
  bankAccountOptions: { id: string; label: string; companyId: string | null }[];
  contactOptions: { id: string; displayName: string; companyId: string | null }[];
}) {
  const [companyId, setCompanyId] = useState(defaults?.companyId ?? "");
  const [contactId, setContactId] = useState(defaults?.contactId ?? "");
  const [bankAccountId, setBankAccountId] = useState(defaults?.bankAccountId ?? "");
  // The chosen company's contacts and bank accounts, plus the global ones — a
  // record with no company is visible to every company.
  const visibleContacts = contactOptions.filter(inCompany(companyId));
  const visibleBankAccounts = bankAccountOptions.filter(inCompany(companyId));
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
            // Anything the new company can't see is dropped rather than left
            // showing a blank row — a cheque filed under one company can't
            // settle into another company's bank account.
            if (contactId && !contactOptions.some((c) => c.id === contactId && inCompany(e.target.value)(c))) setContactId("");
            if (bankAccountId && !bankAccountOptions.some((b) => b.id === bankAccountId && inCompany(e.target.value)(b))) setBankAccountId("");
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
      <label className={labelClass}>
        <span className={labelTextClass}>Bank account</span>
        <select name="bankAccountId" value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)} className={inputClass}>
          <option value="">— None —</option>
          {visibleBankAccounts.map((b) => (
            <option key={b.id} value={b.id}>
              {b.label}
            </option>
          ))}
        </select>
      </label>
      <label className={labelClass}>
        <span className={labelTextClass}>Contact</span>
        <select name="contactId" value={contactId} onChange={(e) => setContactId(e.target.value)} className={inputClass}>
          <option value="">— None —</option>
          {visibleContacts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.displayName}
            </option>
          ))}
        </select>
      </label>
      <label className={labelClass}>
        <span className={labelTextClass}>Cheque number</span>
        <input name="chequeNumber" type="text" required defaultValue={defaults?.chequeNumber} className={inputClass} />
      </label>
      <label className={labelClass}>
        <span className={labelTextClass}>Cheque date</span>
        <DateField name="chequeDate" required defaultValue={defaults?.chequeDate ?? todayISO()} className={inputClass} />
      </label>
      <label className={labelClass}>
        <span className={labelTextClass}>Amount</span>
        <input name="amount" type="number" step="0.1" required defaultValue={defaults?.amount} className={inputClass} />
      </label>
      <label className={labelClass}>
        <span className={labelTextClass}>Cheque type</span>
        <select name="chequeType" required defaultValue={defaults?.chequeType ?? ""} className={inputClass}>
          <option value="" disabled>
            Select a type
          </option>
          {CHEQUE_TYPES.map((t) => (
            <option key={t} value={t}>
              {t.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </label>
      <label className={labelClass}>
        <span className={labelTextClass}>Status</span>
        <select name="status" required defaultValue={defaults?.status ?? "IN_HAND"} className={inputClass}>
          {CHEQUE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input name="issuedByCompany" type="checkbox" defaultChecked={defaults?.issuedByCompany ?? false} className="h-5 w-5 rounded border-sand" />
        <span className={labelTextClass}>Issued by company</span>
      </label>
      <label className={labelClass}>
        <span className={labelTextClass}>Remarks</span>
        <textarea name="remarks" defaultValue={defaults?.remarks ?? ""} className={`${inputClass} h-24 py-2`} />
      </label>
    </>
  );
}

// --- Cheque batch ---

type ChequeBatchRowLocal = {
  companyId: string;
  bankAccountId: string;
  contactId: string;
  contactText: string;
  chequeNumber: string;
  chequeDate: string;
  amount: string;
  chequeType: string;
  status: string;
  issuedByCompany: boolean;
};

export type CreatedCheque = { id: string; name: string };

export function ChequeBatchAddDialog({
  companyOptions,
  bankAccountOptions,
  contactOptions,
  onClose,
  onDone,
  initialRows,
}: {
  companyOptions: CompanyOption[];
  // companyId rides along so the pickers can drop the accounts the chosen
  // company can't see — null means global, visible to every company.
  bankAccountOptions: { id: string; label: string; companyId: string | null }[];
  contactOptions: { id: string; displayName: string; companyId: string | null }[];
  onClose: () => void;
  onDone: (created?: CreatedCheque[]) => void;
  initialRows?: number;
}) {
  const defaultCompanyId = companyOptions[0]?.id ?? "";
  // Bank accounts added from the toolbar flow into every row's dropdown — a bank
  // account needs a title and a number, so it can't be created from a name typed
  // into a cell. A contact can: the contact cell is a ComboBox that takes free
  // text and lets the server create it, which is why there's no + Add Contact
  // button up here. Cheques themselves have no page beyond Accounts, so they're
  // the thing being batch-created here, not a quick-add target.
  const [bankOpts, setBankOpts] = useState(bankAccountOptions);
  const contactOpts = contactOptions;

  const emptyRow = (): ChequeBatchRowLocal => ({
    companyId: defaultCompanyId,
    bankAccountId: "",
    contactId: "",
    contactText: "",
    chequeNumber: "",
    chequeDate: "",
    amount: "",
    chequeType: CHEQUE_TYPES[0],
    status: "IN_HAND",
    issuedByCompany: false,
  });

  return (
    <BatchAddDialog<ChequeBatchRowLocal, CreatedCheque>
      title="Add Cheques"
      onClose={onClose}
      onDone={onDone}
      initialRows={initialRows}
      emptyRow={emptyRow}
      headers={["Company", "Bank Account", "Contact", "Cheque #", "Date", "Amount", "Type", "Status", "By Company"]}
      toolbar={
        <QuickAddButton<CreatedBankAccount>
          label="+ Add Bank Account"
          onCreated={(rows) => setBankOpts((prev) => [...rows.map((r) => ({ id: r.id, label: r.name, companyId: r.companyId })), ...prev])}
          renderDialog={({ onClose, onCreated }) => (
            <BankAccountBatchAddDialog companyOptions={companyOptions} initialRows={1} onClose={onClose} onDone={(created) => onCreated(created ?? [])} />
          )}
        />
      }
      onSubmit={async (rows) => {
        const values: ChequeBatchRow[] = rows.map((r) => ({
          companyId: r.companyId,
          bankAccountId: r.bankAccountId || null,
          contactId: r.contactId || null,
          contactName: r.contactText.trim() || null,
          chequeNumber: r.chequeNumber.trim(),
          chequeDate: r.chequeDate,
          amount: r.amount.trim() || "0",
          chequeType: r.chequeType as (typeof CHEQUE_TYPES)[number],
          status: r.status as (typeof CHEQUE_STATUSES)[number],
          issuedByCompany: r.issuedByCompany,
        }));
        return createChequesBatch(values);
      }}
      renderRow={(row, i, update) => (
        <>
          <td className={batchCellClass}>
            <select
              value={row.companyId}
              onChange={(e) => {
                // Switching companies drops a picked contact or bank account
                // that the new company can't see; the typed contact text stays
                // and re-resolves against the new company's list on save.
                const contactStillValid = contactOpts.some((c) => c.id === row.contactId && inCompany(e.target.value)(c));
                const bankStillValid = bankOpts.some((b) => b.id === row.bankAccountId && inCompany(e.target.value)(b));
                update({
                  companyId: e.target.value,
                  ...(contactStillValid ? {} : { contactId: "" }),
                  ...(bankStillValid ? {} : { bankAccountId: "" }),
                });
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
            <select value={row.bankAccountId} onChange={(e) => update({ bankAccountId: e.target.value })} className={batchInputClass}>
              <option value="">— None —</option>
              {bankOpts.filter(inCompany(row.companyId)).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                </option>
              ))}
            </select>
          </td>
          <td className={batchCellClass}>
            <ComboBox
              value={row.contactText}
              options={contactOpts.filter(inCompany(row.companyId)).map((c) => ({ id: c.id, name: c.displayName }))}
              placeholder="Pick or type a new one"
              className={batchInputClass}
              onChange={(name) =>
                update({
                  contactText: name,
                  contactId: contactOpts.find((c) => inCompany(row.companyId)(c) && c.displayName === name)?.id ?? "",
                })
              }
            />
          </td>
          <td className={batchCellClass}>
            <input value={row.chequeNumber} onChange={(e) => update({ chequeNumber: e.target.value })} className={batchInputClass} />
          </td>
          <td className={batchCellClass}>
            <DateField value={row.chequeDate} onChange={(chequeDate) => update({ chequeDate })} className={batchInputClass} />
          </td>
          <td className={batchCellClass}>
            <input type="number" step="0.1" value={row.amount} onChange={(e) => update({ amount: e.target.value })} className={batchInputClass} />
          </td>
          <td className={batchCellClass}>
            <select value={row.chequeType} onChange={(e) => update({ chequeType: e.target.value })} className={batchInputClass}>
              {CHEQUE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </td>
          <td className={batchCellClass}>
            <select value={row.status} onChange={(e) => update({ status: e.target.value })} className={batchInputClass}>
              {CHEQUE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </td>
          <td className={`${batchCellClass} text-center`}>
            <input type="checkbox" checked={row.issuedByCompany} onChange={(e) => update({ issuedByCompany: e.target.checked })} className="h-5 w-5 rounded border-sand" />
          </td>
        </>
      )}
    />
  );
}

// The "+" that sits beside a cheque picker on the payment and expense forms.
// Settling by cheque means the cheque has to be in the register first, and until
// this existed that meant abandoning a half-filled payment, going to Accounts,
// entering the cheque, and coming back to start again.
//
// Deliberately not QuickAddSelect: the pickers it stands next to also list bank
// and cash accounts depending on how the payment is being settled, so the "+"
// appears and disappears while the dropdown beside it stays put.
export function ChequeQuickAddButton({
  companyOptions,
  bankAccountOptions,
  contactOptions,
  onCreated,
}: {
  companyOptions: CompanyOption[];
  bankAccountOptions: { id: string; label: string; companyId: string | null }[];
  contactOptions: { id: string; displayName: string; companyId: string | null }[];
  onCreated: (created: CreatedCheque[]) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={quickAddButtonClass} title="Add cheque">
        +
      </button>
      {open && (
        <ChequeBatchAddDialog
          companyOptions={companyOptions}
          bankAccountOptions={bankAccountOptions}
          contactOptions={contactOptions}
          initialRows={1}
          onClose={() => setOpen(false)}
          onDone={(created) => {
            setOpen(false);
            if (created && created.length > 0) onCreated(created);
          }}
        />
      )}
    </>
  );
}

export function ChequeEditForm({
  chequeId,
  defaults,
  companyOptions,
  bankAccountOptions,
  contactOptions,
  onDone,
}: {
  chequeId: string;
  defaults: ChequeValues;
  companyOptions: CompanyOption[];
  // companyId rides along so the pickers can drop the accounts the chosen
  // company can't see — null means global, visible to every company.
  bankAccountOptions: { id: string; label: string; companyId: string | null }[];
  contactOptions: { id: string; displayName: string; companyId: string | null }[];
  onDone?: () => void;
}) {
  const [state, action, pending] = useActionState(updateCheque.bind(null, chequeId), undefined);

  useEffect(() => {
    if (state?.success) onDone?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.success]);

  return (
    <form action={action} className="flex flex-col gap-4">
      <ChequeFields defaults={defaults} companyOptions={companyOptions} bankAccountOptions={bankAccountOptions} contactOptions={contactOptions} />
      {state?.error && <p className={errorTextClass}>{state.error}</p>}
      {state?.success && <p className={successTextClass}>Saved.</p>}
      <button type="submit" disabled={pending} className={submitClass}>
        {pending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}

export function DeleteChequeButton({ chequeId, onDone }: { chequeId: string; onDone?: () => void }) {
  const [state, action, pending] = useActionState(deleteCheque, undefined);

  useEffect(() => {
    if (state?.success) onDone?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.success]);

  return (
    <form action={action} onSubmit={(e) => { if (!confirm("Delete this cheque?")) e.preventDefault(); }}>
      <input type="hidden" name="chequeId" value={chequeId} />
      <button type="submit" disabled={pending} className={deleteButtonClass}>
        {pending ? "Deleting…" : "Delete this cheque"}
      </button>
      {state?.error && <p className={`mt-2 ${errorTextClass}`}>{state.error}</p>}
    </form>
  );
}
