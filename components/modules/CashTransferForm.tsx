"use client";

import { useActionState, useEffect, useState } from "react";
import { createCashTransfer, deleteCashTransfer } from "@/lib/actions/transfers";
import { Dialog } from "@/components/ui/Dialog";
import { inputClass, labelClass, labelTextClass, submitClass, deleteButtonClass, errorTextClass } from "@/components/ui/form-styles";
import { DateField } from "@/components/ui/DateField";
import { todayISO } from "@/lib/format";

type Option = { id: string; name: string };

// Cash and bank accounts in one dropdown — "cash:<id>" / "bank:<id>" — so picking
// where the money goes is one choice, not an account kind plus an account.
export type TransferAccount = { value: string; label: string };

export function transferAccounts(bank: Option[], cash: Option[]): TransferAccount[] {
  return [
    ...cash.map((c) => ({ value: `cash:${c.id}`, label: `Cash: ${c.name}` })),
    ...bank.map((b) => ({ value: `bank:${b.id}`, label: `Account: ${b.name}` })),
  ];
}

export function CashTransferDialog({
  companyOptions,
  accounts,
  onClose,
  onDone,
}: {
  companyOptions: Option[];
  accounts: TransferAccount[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState(createCashTransfer, undefined);
  const [from, setFrom] = useState("");

  useEffect(() => {
    if (state?.success) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.success]);

  return (
    <Dialog title="Transfer Money" onClose={onClose}>
      <form action={action} className="flex flex-col gap-4">
        <label className={labelClass}>
          <span className={labelTextClass}>Company</span>
          <select name="companyId" required defaultValue={companyOptions[0]?.id ?? ""} className={inputClass}>
            <option value="" disabled>
              Select a company
            </option>
            {companyOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <label className={labelClass}>
          <span className={labelTextClass}>From</span>
          <select name="fromAccount" required value={from} onChange={(e) => setFrom(e.target.value)} className={inputClass}>
            <option value="" disabled>
              {accounts.length === 0 ? "No accounts yet — create one first" : "Select an account"}
            </option>
            {accounts.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        </label>

        <label className={labelClass}>
          <span className={labelTextClass}>To</span>
          {/* The source is left out so the two can't be the same — the server
              rejects it too, this just doesn't offer it. */}
          <select name="toAccount" required defaultValue="" className={inputClass}>
            <option value="" disabled>
              Select an account
            </option>
            {accounts
              .filter((a) => a.value !== from)
              .map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
          </select>
        </label>

        <div className="flex flex-wrap gap-3">
          <label className={`${labelClass} w-40`}>
            <span className={labelTextClass}>Amount</span>
            <input name="amount" type="number" min="0.01" step="0.01" required className={inputClass} />
          </label>
          <label className={`${labelClass} w-40`}>
            <span className={labelTextClass}>Date</span>
            <DateField name="documentDate" required defaultValue={todayISO()} className={inputClass} />
          </label>
        </div>

        <p className="text-sm text-steel">Moves the money between your own accounts — nobody is owed anything, so no ledger balance changes.</p>

        {state?.error && <p className={errorTextClass}>{state.error}</p>}

        <button type="submit" disabled={pending} className={submitClass}>
          {pending ? "Transferring…" : "Transfer"}
        </button>
      </form>
    </Dialog>
  );
}

export function DeleteCashTransferButton({ transferId, onDone }: { transferId: string; onDone: () => void }) {
  const [state, action, pending] = useActionState(deleteCashTransfer, undefined);

  useEffect(() => {
    if (state?.success) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.success]);

  return (
    <form action={action} onSubmit={(e) => { if (!confirm("Delete this transfer? The money goes back to the account it left.")) e.preventDefault(); }}>
      <input type="hidden" name="documentId" value={transferId} />
      <button type="submit" disabled={pending} className={deleteButtonClass}>
        {pending ? "Deleting…" : "Delete this transfer"}
      </button>
      {state?.error && <p className={`mt-2 ${errorTextClass}`}>{state.error}</p>}
    </form>
  );
}
