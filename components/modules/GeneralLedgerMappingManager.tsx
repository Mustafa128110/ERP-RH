"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { cancelGeneralLedgerOpeningBalance, createGeneralLedgerAccount, createGeneralLedgerOpeningBalance, deactivateGeneralLedgerAccount, initializeGeneralLedgerAccounts, mapSettlementAccountToGeneralLedger } from "@/lib/actions/accounts";
import { inputClass, labelClass, labelTextClass, submitClass } from "@/components/ui/form-styles";

type Gl = { id: string; code: string; name: string; accountType: string; isSystem: boolean; isActive: boolean };
type Settlement = { id: string; generalLedgerAccountId: string | null; name: string };
type Result = { error?: string; success?: boolean };

export function GeneralLedgerMappingManager({ company, companies, accounts, openingBalances, bankAccounts, cashAccounts }: { company: { id: string; name: string } | null; companies: { id: string; name: string }[]; accounts: Gl[]; openingBalances: { id: string; number: string; documentDate: string; amount: string }[]; bankAccounts: { id: string; generalLedgerAccountId: string | null; bankName: string; accountNumber: string }[]; cashAccounts: { id: string; generalLedgerAccountId: string | null; name: string }[] }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(async (prev: Result | undefined, data: FormData) => company ? createGeneralLedgerAccount(company.id, prev, data) : { error: "Choose a company." }, undefined);
  const [openingState, setOpeningState] = useState<Result>();
  const [openingPending, setOpeningPending] = useState(false);
  const [openingOperationId, setOpeningOperationId] = useState(() => crypto.randomUUID());

  if (!company) return <p className="text-sm text-steel">No company is available for GL setup.</p>;

  const map = (kind: "bank" | "cash", accountId: string, glId: string) => void mapSettlementAccountToGeneralLedger(kind, accountId, glId || null).then((result) => {
    if (result.error) window.alert(result.error);
    router.refresh();
  });
  const createOpening = async (data: FormData) => {
    setOpeningPending(true);
    const result = await createGeneralLedgerOpeningBalance(company.id, undefined, data);
    setOpeningState(result);
    setOpeningPending(false);
    if (result.success) {
      setOpeningOperationId(crypto.randomUUID());
      router.refresh();
    }
  };
  const rows = (kind: "bank" | "cash", values: Settlement[]) => values.map((row) => (
    <tr key={row.id} className="border-b border-sand">
      <td className="p-2">{row.name}</td>
      <td className="p-2">
        <select defaultValue={row.generalLedgerAccountId ?? ""} onChange={(event) => map(kind, row.id, event.target.value)} className={inputClass}>
          <option value="">1000 — Cash and Bank (fallback)</option>
          {accounts.filter((account) => account.accountType === "asset").map((account) => <option key={account.id} value={account.id}>{account.code} — {account.name}</option>)}
        </select>
      </td>
    </tr>
  ));

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl text-navy-800">General Ledger Setup</h1>
        <p className="text-sm text-steel">{company.name}. Initialize and review the control chart, map settlement accounts, set the cutover date in Settings, then record opening balances at that date.</p>
        <div className="mt-2 flex gap-2">{companies.map((entry) => <Link key={entry.id} href={`/accounts/gl?company=${entry.id}`} className="text-sm text-navy-800 hover:underline">{entry.name}</Link>)}</div>
      </div>

      <div className="rounded border border-sand bg-white p-4">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-steel">{accounts.length ? `${accounts.length} active GL account${accounts.length === 1 ? "" : "s"} available.` : "No GL control accounts have been initialized."}</p>
          <button type="button" className={submitClass} onClick={() => void initializeGeneralLedgerAccounts(company.id).then((result) => { if (result.error) window.alert(result.error); router.refresh(); })}>Initialize control accounts</button>
        </div>
      </div>

      <form action={async (data) => { await action(data); router.refresh(); }} className="flex flex-wrap items-end gap-3 rounded border border-sand bg-white p-4">
        <label className={labelClass}><span className={labelTextClass}>Code</span><input name="code" required className={inputClass} /></label>
        <label className={labelClass}><span className={labelTextClass}>Name</span><input name="name" required className={inputClass} /></label>
        <label className={labelClass}><span className={labelTextClass}>Type</span><select name="accountType" defaultValue="asset" className={inputClass}>{["asset", "liability", "equity", "income", "expense"].map((type) => <option key={type}>{type}</option>)}</select></label>
        <button disabled={pending} className={submitClass}>{pending ? "Adding…" : "Add GL account"}</button>
        {state?.error && <p className="text-sm text-error">{state.error}</p>}
      </form>

      <form action={createOpening} className="flex flex-wrap items-end gap-3 rounded border border-sand bg-white p-4">
        <input type="hidden" name="operationId" value={openingOperationId} />
        <div className="w-full"><h2 className="font-medium text-navy-800">Opening balance journal</h2><p className="text-sm text-steel">After setting the cutover date, enter each opening account balance. Positive posts a debit; negative posts a credit. The other side is 3000 Opening Balances Equity.</p></div>
        <label className={labelClass}><span className={labelTextClass}>Date</span><input name="documentDate" type="date" required className={inputClass} /></label>
        <label className={labelClass}><span className={labelTextClass}>GL account</span><select name="accountId" required className={inputClass}><option value="">Choose account</option>{accounts.filter((account) => account.code !== "3000").map((account) => <option key={account.id} value={account.id}>{account.code} — {account.name}</option>)}</select></label>
        <label className={labelClass}><span className={labelTextClass}>Amount</span><input name="amount" type="number" step="0.01" required className={inputClass} placeholder="+ debit / − credit" /></label>
        <label className={labelClass}><span className={labelTextClass}>Memo</span><input name="memo" className={inputClass} placeholder="Optional" /></label>
        <button disabled={openingPending} className={submitClass}>{openingPending ? "Posting…" : "Post opening balance"}</button>
        {openingState?.error && <p className="text-sm text-error">{openingState.error}</p>}
        {openingState?.success && <p className="text-sm text-success">Opening balance posted.</p>}
      </form>

      {openingBalances.length > 0 && <section className="rounded border border-sand bg-white p-4">
        <h2 className="font-medium text-navy-800">Posted opening journals</h2>
        <table className="mt-3 w-full text-sm"><thead><tr className="text-left text-steel"><th className="p-2">Date</th><th className="p-2">Journal</th><th className="p-2 text-right">Amount</th><th className="p-2" /></tr></thead><tbody>{openingBalances.map((entry) => <tr key={entry.id} className="border-t border-sand"><td className="p-2">{entry.documentDate}</td><td className="p-2">{entry.number}</td><td className="p-2 text-right">{entry.amount}</td><td className="p-2 text-right"><button type="button" className="text-sm text-error hover:underline" onClick={() => { if (window.confirm(`Cancel ${entry.number}? This appends a reversal; it does not erase the journal.`)) void cancelGeneralLedgerOpeningBalance(entry.id).then((result) => { if (result.error) window.alert(result.error); router.refresh(); }); }}>Cancel</button></td></tr>)}</tbody></table>
      </section>}

      {accounts.some((account) => !account.isSystem) && <section className="rounded border border-sand bg-white p-4">
        <h2 className="font-medium text-navy-800">Custom GL accounts</h2>
        <p className="mt-1 text-sm text-steel">Only unused and unmapped custom accounts can be deactivated. Posted accounts remain part of the audit trail.</p>
        <table className="mt-3 w-full text-sm"><thead><tr className="text-left text-steel"><th className="p-2">Code</th><th className="p-2">Account</th><th className="p-2">Type</th><th className="p-2" /></tr></thead><tbody>{accounts.filter((account) => !account.isSystem).map((account) => <tr key={account.id} className="border-t border-sand"><td className="p-2">{account.code}</td><td className="p-2">{account.name}</td><td className="p-2 capitalize">{account.accountType}</td><td className="p-2 text-right"><button type="button" className="text-sm text-error hover:underline" onClick={() => { if (window.confirm(`Deactivate ${account.code} — ${account.name}?`)) void deactivateGeneralLedgerAccount(account.id).then((result) => { if (result.error) window.alert(result.error); router.refresh(); }); }}>Deactivate</button></td></tr>)}</tbody></table>
      </section>}

      <section className="rounded border border-sand bg-white p-4">
        <h2 className="font-medium text-navy-800">Settlement mappings</h2>
        <table className="mt-3 w-full text-sm"><thead><tr className="text-left text-steel"><th className="p-2">Account</th><th className="p-2">GL asset account</th></tr></thead><tbody>{rows("bank", bankAccounts.map((account) => ({ id: account.id, name: `${account.bankName} — ${account.accountNumber}`, generalLedgerAccountId: account.generalLedgerAccountId })))}{rows("cash", cashAccounts)}</tbody></table>
      </section>
    </div>
  );
}
