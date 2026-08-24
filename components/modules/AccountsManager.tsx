"use client";

import { useState } from "react";
import { useNewEntry } from "@/components/layout/KeyboardShortcuts";
import { Dialog } from "@/components/ui/Dialog";
import { DataTable } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { primaryIconButtonClass } from "@/components/ui/form-styles";
import { Icon } from "@/components/ui/Icon";
import type { ColumnDef, Row } from "@/lib/table";
import {
  BankAccountEditForm,
  DeleteBankAccountButton,
  CashAccountEditForm,
  DeleteCashAccountButton,
  ChequeBatchAddDialog,
  ChequeEditForm,
  DeleteChequeButton,
  BankAccountBatchAddDialog,
  CashAccountBatchAddDialog,
  type BankAccountValues,
  type CashAccountValues,
  type ChequeValues,
} from "@/components/modules/AccountForms";
import { CashTransferDialog, DeleteCashTransferButton, transferAccounts } from "@/components/modules/CashTransferForm";
import type { CashTransferRow } from "@/lib/actions/transfers";
import { formatDate } from "@/lib/format";
import { patchFromFormData } from "@/lib/optimistic-records";
import { useOptimisticRecords } from "@/lib/use-optimistic-records";
import { isChequeSpent, UNSPENT_CHEQUE_STATUS } from "@/lib/cheque-constants";
import { bankAccountLabel } from "@/lib/account-label";

interface BankAccount extends BankAccountValues {
  id: string;
}
interface CashAccount extends CashAccountValues {
  id: string;
}
interface Cheque extends ChequeValues {
  id: string;
}

type Tab = "cash" | "bank" | "cheques" | "transfers";
type ModalState =
  | { kind: "batch-bank" }
  | { kind: "edit-bank"; row: BankAccount }
  | { kind: "batch-cash" }
  | { kind: "edit-cash"; row: CashAccount }
  | { kind: "batch-cheque" }
  | { kind: "edit-cheque"; row: Cheque }
  | { kind: "add-transfer" }
  | { kind: "view-transfer"; row: CashTransferRow }
  | null;

// Ordered the way the money is actually handled: the drawer is what the counter
// touches all day, the bank next, cheques after that, and transfers last —
// they're the occasional act of moving between the first two. Cash opens by
// default for the same reason.
const tabs: { id: Tab; label: string }[] = [
  { id: "cash", label: "Cash" },
  { id: "bank", label: "Bank Accounts" },
  { id: "cheques", label: "Cheques" },
  { id: "transfers", label: "Transfers" },
];

const bankColumns: ColumnDef[] = [
  { key: "bankName", label: "Bank" },
  { key: "branchName", label: "Branch" },
  { key: "accountTitle", label: "Title" },
  { key: "accountNumber", label: "Account #" },
  { key: "balance", label: "Balance", align: "right" },
  { key: "company", label: "Company" },
  { key: "status", label: "Status", badge: true },
];

const cashColumns: ColumnDef[] = [
  { key: "name", label: "Name" },
  { key: "balance", label: "Balance", align: "right" },
  { key: "company", label: "Company" },
  { key: "status", label: "Status", badge: true },
];

const transferColumns: ColumnDef[] = [
  { key: "number", label: "Ref" },
  { key: "date", label: "Date" },
  { key: "from", label: "From" },
  { key: "to", label: "To" },
  { key: "amount", label: "Amount", align: "right" },
  { key: "company", label: "Company" },
];

const chequeColumns: ColumnDef[] = [
  { key: "chequeNumber", label: "Cheque #" },
  { key: "date", label: "Date" },
  { key: "amount", label: "Amount", align: "right" },
  { key: "type", label: "Type" },
  { key: "status", label: "Status", badge: true },
  { key: "bankAccount", label: "Bank Account" },
  { key: "contact", label: "Contact" },
  { key: "company", label: "Company" },
];

export function AccountsManager({
  bankAccounts,
  cashAccounts,
  cheques,
  transfers,
  companyOptions,
  contactOptions,
}: {
  bankAccounts: BankAccount[];
  cashAccounts: CashAccount[];
  cheques: Cheque[];
  transfers: CashTransferRow[];
  companyOptions: { id: string; name: string }[];
  contactOptions: { id: string; displayName: string; companyId: string | null }[];
}) {
  const [tab, setTab] = useState<Tab>("cash");
  const [showSpent, setShowSpent] = useState(false);
  const [modal, setModal] = useState<ModalState>(null);

  // Four lists on one screen, so four of these — each tab's rows are the server's
  // list plus whatever is in flight for it. Every field these forms post is
  // stored verbatim (`.set(values)` in lib/actions/accounts.ts, balances
  // included, which are editable here on purpose), so a row can take the whole
  // of what was typed rather than a safe subset of it.
  //
  // Nothing here needs warming: a row's detail is already in the props, so
  // opening one has never cost a round trip. The wait was only ever on the write.
  const bank = useOptimisticRecords(bankAccounts, "id");
  const cash = useOptimisticRecords(cashAccounts, "id");
  const cheque = useOptimisticRecords(cheques, "id");
  const transfer = useOptimisticRecords(transfers, "id");

  const companyName = (id: string | null) => (id ? (companyOptions.find((c) => c.id === id)?.name ?? "—") : "Global");
  // Bank, branch and account title — the same label the pickers, the payments
  // list and the transfers list all use (lib/account-label.ts). Off the optimistic
  // list, so a bank account renamed on its own tab reads the new way in the cheque
  // list and in the transfer picker at once.
  const bankAccountOptions = bank.records.map((b) => ({ id: b.id, label: bankAccountLabel(b), companyId: b.companyId }));
  const bankAccountFor = (id: string | null) => (id ? (bankAccountOptions.find((b) => b.id === id)?.label ?? "—") : "—");
  const contactName = (id: string | null) => (id ? (contactOptions.find((c) => c.id === id)?.displayName ?? "—") : "—");

  function close() {
    setModal(null);
  }

  const bankRows: Row[] = bank.records.map((b) => ({
    id: b.id,
    bankName: b.bankName,
    branchName: b.branchName ?? "—",
    accountTitle: b.accountTitle,
    accountNumber: b.accountNumber,
    balance: b.currentBalance ?? "0",
    company: companyName(b.companyId),
    status: b.isActive ? "Active" : "Inactive",
  }));
  function openEditBank(row: Row) {
    const account = bank.records.find((b) => b.id === row.id);
    if (account) setModal({ kind: "edit-bank", row: account });
  }

  const cashRows: Row[] = cash.records.map((c) => ({
    id: c.id,
    name: c.name,
    balance: c.currentBalance ?? "0",
    company: companyName(c.companyId),
    status: c.isActive ? "Active" : "Inactive",
  }));
  function openEditCash(row: Row) {
    const account = cash.records.find((c) => c.id === row.id);
    if (account) setModal({ kind: "edit-cash", row: account });
  }

  // Spent cheques stay in the register but off the working list — see the
  // checkbox on the cheques tab. Marking one cleared therefore takes it off this
  // list on the press, which is exactly what the person doing it meant.
  const spentCount = cheque.records.filter((c) => isChequeSpent(c.status)).length;
  const chequeRows: Row[] = cheque.records
    .filter((c) => showSpent || !isChequeSpent(c.status))
    .map((c) => ({
      id: c.id,
      chequeNumber: c.chequeNumber,
      date: formatDate(c.chequeDate),
      amount: c.amount,
      type: c.chequeType.replace(/_/g, " "),
      status: c.status.replace(/_/g, " "),
      bankAccount: bankAccountFor(c.bankAccountId),
      contact: contactName(c.contactId),
      company: companyName(c.companyId),
    }));
  function openEditCheque(row: Row) {
    const found = cheque.records.find((c) => c.id === row.id);
    if (found) setModal({ kind: "edit-cheque", row: found });
  }

  const transferRows: Row[] = transfer.records.map((t) => ({
    id: t.id,
    number: t.number,
    date: formatDate(t.documentDate),
    from: t.from,
    to: t.to,
    amount: t.amount,
    company: t.company,
  }));
  // A transfer has nothing to edit that isn't simpler to delete and re-enter —
  // it's four fields, and changing the accounts means moving the money back and
  // out again anyway.
  function openTransfer(row: Row) {
    const found = transfer.records.find((t) => t.id === row.id);
    if (found) setModal({ kind: "view-transfer", row: found });
  }

  // Both kinds of account in one list, which is what the transfer form picks
  // from — plus the cheques still in hand, which can only be a source: paying a
  // transfer out with one spends it.
  const accountsForTransfer = transferAccounts(
    bank.records.map((b) => ({ id: b.id, name: bankAccountLabel(b) })),
    cash.records.map((c) => ({ id: c.id, name: c.name })),
    // In hand only: a cheque already received against a payment or issued
    // against one is spoken for, and taking it here would cut it loose from the
    // document it settled.
    cheque.records.filter((c) => c.status === UNSPENT_CHEQUE_STATUS).map((c) => ({ id: c.id, name: `${c.chequeNumber} (${c.amount})` })),
  );

  // Whatever the open tab makes, same as the button beside it.
  useNewEntry(() =>
    setModal(
      tab === "bank"
        ? { kind: "batch-bank" }
        : tab === "cash"
          ? { kind: "batch-cash" }
          : tab === "transfers"
            ? { kind: "add-transfer" }
            : { kind: "batch-cheque" },
    ),
  );

  // Every tab creates in batch. The label just names whichever the active tab
  // is about — and since the button became a bare plus, this label is now the
  // whole of what says so, to a hover and to a screen reader alike.
  const addLabel =
    tab === "transfers"
      ? "Transfer money"
      : `Add ${tab === "cash" ? "cash accounts" : tab === "bank" ? "bank accounts" : "cheques"}`;

  return (
    <div className="flex h-full flex-col gap-2">
      <PageHeader title="Accounts">
        <button
          type="button"
          onClick={() =>
            setModal(
              tab === "bank"
                ? { kind: "batch-bank" }
                : tab === "cash"
                  ? { kind: "batch-cash" }
                  : tab === "transfers"
                    ? { kind: "add-transfer" }
                    : { kind: "batch-cheque" },
            )
          }
          className={primaryIconButtonClass}
          // The label still changes with the tab even though the glyph doesn't
          // — it is the only thing left saying what the plus will add.
          aria-label={addLabel}
          title={`${addLabel} — Alt+N`}
        >
          <Icon name="plus" />
        </button>
      </PageHeader>

      <div className="flex shrink-0 gap-1 border-b border-sand">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium ${
              tab === t.id ? "border-b-2 border-navy-800 text-navy-800" : "text-steel hover:text-navy-800"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Same order as the tabs above: cash, bank, cheques, transfers. */}
      {tab === "cash" && (
        <DataTable
          columns={cashColumns}
          rows={cashRows}
          idKey="id"
          onRowClick={openEditCash}
          pendingIds={cash.pending}
          emptyMessage="No cash accounts yet."
          searchPlaceholder="Search cash accounts…"
        />
      )}

      {tab === "bank" && (
        <DataTable
          columns={bankColumns}
          rows={bankRows}
          idKey="id"
          onRowClick={openEditBank}
          pendingIds={bank.pending}
          emptyMessage="No bank accounts yet."
          searchPlaceholder="Search bank accounts…"
        />
      )}

      {tab === "cheques" && (
        <>
          {/* A cheque that has been issued, cleared, cancelled or voided is done
              with — off the working list, not deleted. The box brings the
              history back, because "what happened to cheque 44215" is a real
              question and the register is where it's answered. */}
          <label className="flex shrink-0 items-center gap-2 text-sm text-steel">
            <input type="checkbox" checked={showSpent} onChange={(e) => setShowSpent(e.target.checked)} className="h-5 w-5 rounded border-sand" />
            Show settled cheques{spentCount > 0 && ` (${spentCount})`}
          </label>
          <DataTable
            columns={chequeColumns}
            rows={chequeRows}
            idKey="id"
            onRowClick={openEditCheque}
            pendingIds={cheque.pending}
            emptyMessage={showSpent ? "No cheques yet." : "No cheques in hand."}
            searchPlaceholder="Search cheques…"
          />
        </>
      )}

      {tab === "transfers" && (
        <DataTable
          columns={transferColumns}
          rows={transferRows}
          idKey="id"
          onRowClick={openTransfer}
          pendingIds={transfer.pending}
          emptyMessage="No transfers yet — move money between your cash drawers and bank accounts here."
          searchPlaceholder="Search transfers…"
        />
      )}

      {modal?.kind === "add-transfer" && (
        <CashTransferDialog companyOptions={companyOptions} accounts={accountsForTransfer} onClose={() => setModal(null)} onDone={close} />
      )}

      {modal?.kind === "view-transfer" && (
        // Hidden rather than closed while the cancellation is in the air, the same
        // as the edit popups below: `pending` empties when the action settles, so a
        // refusal brings this straight back with the error on it, and a success
        // closes it for real from onDone.
        <Dialog title={`${modal.row.from} → ${modal.row.to}`} onClose={close} hidden={transfer.pending.includes(modal.row.id)}>
          <div className="flex flex-col gap-4">
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
              <dt className="text-steel">Reference</dt>
              <dd className="text-ink">{modal.row.number}</dd>
              <dt className="text-steel">Date</dt>
              <dd className="text-ink">{formatDate(modal.row.documentDate)}</dd>
              <dt className="text-steel">Amount</dt>
              <dd className="tabular-nums text-ink">{modal.row.amount}</dd>
              <dt className="text-steel">Company</dt>
              <dd className="text-ink">{modal.row.company}</dd>
            </dl>
            <div className="rounded border border-error/30 bg-error-tint p-4">
              <DeleteCashTransferButton transferId={modal.row.id} onDone={close} onDeleting={() => transfer.remove(modal.row.id)} />
            </div>
          </div>
        </Dialog>
      )}

      {modal?.kind === "edit-bank" && (
        <Dialog title={modal.row.accountTitle} onClose={close} hidden={bank.pending.includes(modal.row.id)}>
          <div className="flex flex-col gap-4">
            <BankAccountEditForm
              accountId={modal.row.id}
              defaults={modal.row}
              companyOptions={companyOptions}
              onDone={close}
              // Everything this form posts is stored as typed, so the row can take
              // the lot. The two ticks are set by hand: `patchFromFormData` only
              // copies fields the record holds as a string, and an unticked box
              // posts nothing at all — so reading them off the record instead of
              // off the form would leave a box that was just cleared still ticked.
              onSaving={(formData) =>
                bank.patch(modal.row.id, {
                  ...patchFromFormData(modal.row, formData),
                  isDefault: formData.get("isDefault") === "on",
                  isActive: formData.get("isActive") === "on",
                })
              }
            />
            <div className="rounded border border-error/30 bg-error-tint p-4">
              <DeleteBankAccountButton accountId={modal.row.id} onDone={close} onDeleting={() => bank.remove(modal.row.id)} />
            </div>
          </div>
        </Dialog>
      )}

      {modal?.kind === "batch-bank" && <BankAccountBatchAddDialog companyOptions={companyOptions} onClose={() => setModal(null)} onDone={close} />}

      {modal?.kind === "edit-cash" && (
        <Dialog title={modal.row.name} onClose={close} hidden={cash.pending.includes(modal.row.id)}>
          <div className="flex flex-col gap-4">
            <CashAccountEditForm
              accountId={modal.row.id}
              defaults={modal.row}
              companyOptions={companyOptions}
              onDone={close}
              onSaving={(formData) =>
                cash.patch(modal.row.id, {
                  ...patchFromFormData(modal.row, formData),
                  isDefault: formData.get("isDefault") === "on",
                  isActive: formData.get("isActive") === "on",
                })
              }
            />
            <div className="rounded border border-error/30 bg-error-tint p-4">
              <DeleteCashAccountButton accountId={modal.row.id} onDone={close} onDeleting={() => cash.remove(modal.row.id)} />
            </div>
          </div>
        </Dialog>
      )}

      {modal?.kind === "batch-cash" && <CashAccountBatchAddDialog companyOptions={companyOptions} onClose={() => setModal(null)} onDone={close} />}

      {modal?.kind === "batch-cheque" && (
        <ChequeBatchAddDialog
          companyOptions={companyOptions}
          bankAccountOptions={bankAccountOptions}
          contactOptions={contactOptions}
          onClose={() => setModal(null)}
          onDone={close}
        />
      )}
      {modal?.kind === "edit-cheque" && (
        <Dialog title={modal.row.chequeNumber} onClose={close} hidden={cheque.pending.includes(modal.row.id)}>
          <div className="flex flex-col gap-4">
            <ChequeEditForm
              chequeId={modal.row.id}
              defaults={modal.row}
              companyOptions={companyOptions}
              bankAccountOptions={bankAccountOptions}
              contactOptions={contactOptions}
              onDone={close}
              // A new status takes effect on the press, which on this screen also
              // means a cheque marked cleared leaves the working list at once —
              // see the filter above.
              onSaving={(formData) =>
                cheque.patch(modal.row.id, {
                  ...patchFromFormData(modal.row, formData),
                  issuedByCompany: formData.get("issuedByCompany") === "on",
                })
              }
            />
            <div className="rounded border border-error/30 bg-error-tint p-4">
              <DeleteChequeButton chequeId={modal.row.id} onDone={close} onDeleting={() => cheque.remove(modal.row.id)} />
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}
