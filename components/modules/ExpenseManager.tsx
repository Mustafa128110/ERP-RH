"use client";

import { useState } from "react";
import { useNewEntry } from "@/components/layout/KeyboardShortcuts";
import { Dialog } from "@/components/ui/Dialog";
import { DataTable } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { DetailHover } from "@/components/ui/DetailHover";
import { primaryIconButtonClass } from "@/components/ui/form-styles";
import { Icon } from "@/components/ui/Icon";
import type { ColumnDef, Row } from "@/lib/table";
import { ExpenseEditForm, DeleteExpenseButton, ExpenseBatchAddDialog, type BankOption, type CashOption } from "@/components/modules/ExpenseForm";
import { listChequesForExpenses } from "@/lib/actions/expenses";
import { formatDate, money } from "@/lib/format";
import { groupSameDay, type DayGroup } from "@/lib/day-groups";
import { useCachedOptions } from "@/lib/client-cache";

type Option = { id: string; name: string };
type ScopedOption = Option & { companyId: string };

interface Expense {
  id: string;
  companyId: string;
  company: string;
  expenseCategoryId: string;
  category: string;
  bankAccountId: string | null;
  cashAccountId: string | null;
  chequeId: string | null;
  paymentMethod: string | null;
  amount: string;
  expenseDate: string;
  notes: string | null;
  attachmentUrl: string | null;
  createdByName: string | null;
}

type ModalState =
  | { kind: "batch" }
  | { kind: "edit"; expense: Expense }
  // A grouped row stands for several expenses, so there's no single record to
  // open until one is picked.
  | { kind: "choose"; group: DayGroup<Expense> }
  | null;

// `render` closes over the grouped expenses so the category cell can list them —
// Row only holds primitives, and a group's members are a list.
const buildColumns = (byRowId: Map<string, DayGroup<Expense>>): ColumnDef[] => [
  { key: "date", label: "Date" },
  {
    key: "category",
    label: "Category",
    // The note is the part of an expense that says what it actually was ("van
    // tyres, Shahrah-e-Faisal"), and it never fits a column. Hovering the
    // category shows it along with everything else the row had to leave out.
    //
    // A row standing for a day's several expenses under one category is asked a
    // different question, so it gets the other panel: what each of them was, and
    // what they came to.
    render: (row) => {
      const members = byRowId.get(String(row.id))?.members ?? [];
      return members.length > 1 ? (
        <DetailHover
          trigger={String(row.category)}
          heading={`${row.category} — ${row.date}`}
          width={340}
          lines={members.map((m) => ({
            // The note is what tells one of the day's entries from the next, so
            // it's the line here and the method is the aside.
            text: m.notes ?? m.paymentMethod ?? "—",
            value: money(m.amount),
          }))}
          footer={`Total ${row.amount}`}
        />
      ) : (
        <DetailHover
          trigger={String(row.category)}
          heading={String(row.category)}
          rows={[
            { label: "Amount", value: String(row.amount) },
            { label: "Paid by", value: String(row.method) },
            { label: "Company", value: String(row.company) },
            { label: "Entered by", value: String(row.user) },
          ]}
          footer={row.notes ? String(row.notes) : undefined}
          extraHeight={row.notes ? 16 : 0}
        />
      );
    },
  },
  { key: "company", label: "Company" },
  { key: "amount", label: "Amount", align: "right" },
  { key: "method", label: "Method" },
  { key: "user", label: "Created By" },
];

export function ExpenseManager({
  expenses,
  filtered,
  companyOptions,
  categoryOptions,
  contactOptions,
  bankAccountOptions,
  cashAccountOptions,
  chequeOptions,
  filters,
}: {
  expenses: Expense[];
  // Whether any filter is on, so an empty list can say why it's empty.
  filtered?: boolean;
  companyOptions: Option[];
  categoryOptions: ScopedOption[];
  // Only used by the cheque quick-add, which files the cheque against a party.
  contactOptions: ScopedOption[];
  bankAccountOptions: BankOption[];
  cashAccountOptions: CashOption[];
  chequeOptions: Option[];
  // The filter controls, built by the page — they drive query params, so the
  // filtering happens up there rather than over the rows already handed down.
  filters?: React.ReactNode;
}) {
  // Seed the client reference cache from the live options (so an offline batch
  // dialog can still fill its pickers) and fall back to the cached copy when the
  // page rendered empty. Live always wins when present.
  const cachedCompany = useCachedOptions("companies", companyOptions);
  const cachedCategories = useCachedOptions("expenseCategories", categoryOptions);
  const cachedContacts = useCachedOptions("contacts", contactOptions);
  const cachedBank = useCachedOptions("bankAccounts", bankAccountOptions);
  const cachedCash = useCachedOptions("cashAccounts", cashAccountOptions);
  const cachedCheques = useCachedOptions("cheques", chequeOptions);

  const [modal, setModal] = useState<ModalState>(null);
  const [editChequeOptions, setEditChequeOptions] = useState<Option[]>(chequeOptions);

  function close() {
    setModal(null);
  }

  // A day's several expenses under one category read as one line, so the list
  // says "fuel, Tuesday, this much" instead of four rows with nothing tying
  // their amounts together.
  const groups = groupSameDay(
    expenses,
    (e) => `${e.companyId}|${e.expenseCategoryId}|${e.expenseDate}`,
    (e) => e.amount,
  );
  const byRowId = new Map(groups.map((g) => [g.key, g]));
  const columns = buildColumns(byRowId);

  const rows: Row[] = groups.map(({ key, members, total }) => {
    const first = members[0];
    const methods = new Set(members.map((m) => m.paymentMethod ?? "—"));
    const users = new Set(members.map((m) => m.createdByName ?? "—"));
    return {
      // The group key, not an expense id — a grouped row doesn't stand for one
      // record, and the edit form is given the id that gets picked.
      id: key,
      date: formatDate(first.expenseDate),
      category: members.length > 1 ? `${first.category} (${members.length})` : first.category,
      company: first.company,
      amount: money(total),
      // One method named, or the fact that they differ — naming the first would
      // claim the rest were paid the same way.
      method: methods.size === 1 ? [...methods][0] : "Mixed",
      user: users.size === 1 ? [...users][0] : "Several",
      // Not columns — read on hover. Carried on the row anyway so the table's
      // search box finds an expense by what was written on it, and so a note on
      // any member of a group still matches the line it folded into.
      notes: members.map((m) => m.notes).filter(Boolean).join(" · ") || null,
    };
  });

  async function openEdit(expense: Expense) {
    setModal({ kind: "edit", expense });
    setEditChequeOptions(await listChequesForExpenses(expense.id));
  }

  useNewEntry(() => setModal({ kind: "batch" }));

  return (
    <div className="flex h-full flex-col gap-2">
      <PageHeader
        title="Expenses"
        subtitle={`${expenses.length} expense(s)${expenses.length !== groups.length ? ` on ${groups.length} line(s)` : ""}${filtered ? " matching" : ""}`}
      >
        {filters}
        <button
          type="button"
          onClick={() => setModal({ kind: "batch" })}
          className={primaryIconButtonClass}
          aria-label="Add expenses"
          title="Add expenses — Alt+N"
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
          if (group.members.length === 1) openEdit(group.members[0]);
          else setModal({ kind: "choose", group });
        }}
        emptyMessage={filtered ? "No expenses match these filters." : "No expenses yet."}
        searchPlaceholder="Search expenses…"
      />

      {modal?.kind === "batch" && (
        <ExpenseBatchAddDialog
          companyOptions={cachedCompany.value}
          categoryOptions={cachedCategories.value}
          contactOptions={cachedContacts.value}
          bankAccountOptions={cachedBank.value}
          cashAccountOptions={cachedCash.value}
          chequeOptions={cachedCheques.value}
          onClose={() => setModal(null)}
          onDone={close}
        />
      )}

      {modal?.kind === "choose" && (
        <Dialog
          title={`${modal.group.members[0].category} — ${formatDate(modal.group.members[0].expenseDate)}`}
          onClose={() => setModal(null)}
        >
          <ul className="flex flex-col">
            {modal.group.members.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() => openEdit(e)}
                  className="flex w-full items-baseline justify-between gap-4 border-b border-sand px-1 py-3 text-left hover:bg-brass-100"
                >
                  <span className="min-w-0 truncate text-ink">{e.notes ?? e.paymentMethod ?? "—"}</span>
                  <span className="shrink-0 tabular-nums text-ink">{money(e.amount)}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="flex justify-between px-1 pt-3 font-semibold text-ink">
            <span>Total</span>
            <span className="tabular-nums">{money(modal.group.total)}</span>
          </p>
        </Dialog>
      )}

      {modal?.kind === "edit" && (
        <Dialog title={modal.expense.category} onClose={close}>
          <div className="flex flex-col gap-4">
            <ExpenseEditForm
              expenseId={modal.expense.id}
              defaults={modal.expense}
              companyOptions={companyOptions}
              categoryOptions={categoryOptions}
              contactOptions={contactOptions}
              bankAccountOptions={bankAccountOptions}
              cashAccountOptions={cashAccountOptions}
              chequeOptions={editChequeOptions}
              onDone={close}
            />
            <div className="rounded border border-error/30 bg-error-tint p-4">
              <DeleteExpenseButton expenseId={modal.expense.id} onDone={close} />
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}
