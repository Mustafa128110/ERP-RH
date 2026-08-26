"use client";

import { useRef, useState } from "react";
import { useNewEntry } from "@/components/layout/KeyboardShortcuts";
import { Dialog } from "@/components/ui/Dialog";
import { DataTable } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { DetailHover } from "@/components/ui/DetailHover";
import { primaryIconButtonClass } from "@/components/ui/form-styles";
import { Icon } from "@/components/ui/Icon";
import type { ColumnDef, Row } from "@/lib/table";
import { ExpenseEditForm, DeleteExpenseButton, ExpenseBatchAddDialog, type BankOption, type CashOption, type ChequeOption } from "@/components/modules/ExpenseForm";
import { listChequesForExpenses } from "@/lib/actions/expenses";
import { formatDate, money } from "@/lib/format";
import { groupSameDay, type DayGroup } from "@/lib/day-groups";
import { useOptimisticRecords } from "@/lib/use-optimistic-records";
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
  documentId: string | null;
  status: "draft" | "pending" | "approved" | "posted" | "cancelled";
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
    sortable: true,
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
  { key: "amount", label: "Amount", align: "right" },
  { key: "method", label: "Method" },
  { key: "company", label: "Company" },
  { key: "user", label: "Created By" },
];

// What an expense can honestly take from the form before the server has
// answered — and it is only these three.
//
// All three are stored verbatim: `readExpenseForm` in lib/actions/expenses.ts
// reads `amount`, `expenseDate` and `notes` straight off the form and the update
// sets them unchanged, so the amount, the date and the note become exactly what
// was typed. The note is trimmed to null when empty, the same way the action
// does it, so a cleared note reads as cleared rather than as an empty string.
//
// The date is part of the grouping key below, so moving it moves the row to the
// day it now belongs to — which is the point.
//
// The category is deliberately left alone even though the form posts one. An
// unrecognised name becomes a *new* category on save, so it has no id yet; and
// the grouping key is built from the category id while the cell shows the name,
// so moving one without the other would file the row under a category it doesn't
// belong to. The method is left alone too — it isn't a stored field, it's read
// back from whichever account settled the expense. Both wait for the payload.
function typedIntoExpense(formData: FormData): Partial<Expense> {
  const values: Partial<Expense> = {};
  const amount = formData.get("amount");
  const expenseDate = formData.get("expenseDate");
  const notes = formData.get("notes");
  if (typeof amount === "string" && amount !== "") values.amount = amount;
  if (typeof expenseDate === "string" && expenseDate !== "") values.expenseDate = expenseDate;
  if (typeof notes === "string") values.notes = notes.trim() || null;
  return values;
}

export function ExpenseManager({
  expenses,
  filtered,
  companyOptions,
  companyCodeMap,
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
  companyCodeMap?: Map<string, string>;
  categoryOptions: ScopedOption[];
  // Only used by the cheque quick-add, which files the cheque against a party.
  contactOptions: ScopedOption[];
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
  const cachedCategories = useCachedOptions("expenseCategories", categoryOptions);
  const cachedContacts = useCachedOptions("contacts", contactOptions);
  const cachedBank = useCachedOptions("bankAccounts", bankAccountOptions);
  const cachedCash = useCachedOptions("cashAccounts", cashAccountOptions);
  const cachedCheques = useCachedOptions("cheques", chequeOptions);

  const [modal, setModal] = useState<ModalState>(null);
  const [editChequeOptions, setEditChequeOptions] = useState<ChequeOption[]>(chequeOptions);

  // The expenses this list shows, which is the server's list plus whatever is in
  // flight. Applied to the expenses themselves rather than to the grouped rows
  // below, so an edited amount re-totals its day line, a new date moves the entry
  // to the day it now belongs to, and a cancelled expense leaves the group — or
  // takes the whole line with it if it was the only one.
  const { records: shown, pending, patch, remove } = useOptimisticRecords(expenses, "id");

  // Cheques already fetched, keyed by expense id. Opening an expense shows the
  // popup at once and then fills its cheque picker a round trip later, so until
  // that lands the picker is holding the *previous* expense's cheques. A pointer
  // resting on the row is enough notice to have fetched them already. Kept on a
  // ref so warming never renders.
  const warmed = useRef(new Map<string, ChequeOption[]>());
  const warming = useRef(new Set<string>());

  async function warm(id: string) {
    if (warmed.current.has(id) || warming.current.has(id)) return;
    warming.current.add(id);
    try {
      warmed.current.set(id, await listChequesForExpenses(id));
    } catch {
      // A failed warm is not a failure — the click will ask again, and if the
      // network is genuinely gone that is where it belongs to be reported.
    } finally {
      warming.current.delete(id);
    }
  }

  // Called from inside the form's own action when a save or a cancellation
  // starts, and it is not housekeeping: the warm copy was taken before this
  // write, so handing it to the next open would show the cheques as they used to
  // be — worse than the round trip it saves.
  function forgetWarm(id: string) {
    warmed.current.delete(id);
  }

  function close() {
    setModal(null);
  }

  // A day's several expenses under one category read as one line, so the list
  // says "fuel, Tuesday, this much" instead of four rows with nothing tying
  // their amounts together.
  const groups = groupSameDay(
    shown,
    (e) => `${e.companyId}|${e.expenseCategoryId}|${e.expenseDate}|${e.status}`,
    (e) => e.amount,
  );
  const byRowId = new Map(groups.map((g) => [g.key, g]));
  const columns = buildColumns(byRowId);

  // A row stands for a group, and `pending` holds expense ids, so a line fades
  // when any expense folded into it is in flight.
  const pendingRowIds =
    pending.length === 0 ? pending : groups.filter((g) => g.members.some((m) => pending.includes(m.id))).map((g) => g.key);

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
      company: companyCodeMap?.get(first.companyId) ?? first.company,
      amount: money(total),
      // One method named, or the fact that they differ — naming the first would
      // claim the rest were paid the same way.
      method: methods.size === 1 ? [...methods][0] : "Mixed",
      user: users.size === 1 ? [...users][0] : "Several",
      status: first.status === "cancelled" ? "Cancelled" : "Posted",
      documentId: first.documentId,
      // Not columns — read on hover. Carried on the row anyway so the table's
      // search box finds an expense by what was written on it, and so a note on
      // any member of a group still matches the line it folded into.
      notes: members.map((m) => m.notes).filter(Boolean).join(" · ") || null,
    };
  });

  async function openEdit(expense: Expense) {
    const ready = warmed.current.get(expense.id);
    if (ready) {
      // Set before the popup mounts, so its cheque picker opens on this expense's
      // cheques rather than on the last one's.
      setEditChequeOptions(ready);
      setModal({ kind: "edit", expense });
      return;
    }
    setModal({ kind: "edit", expense });
    const cheques = await listChequesForExpenses(expense.id);
    // Worth keeping even though this open is already paid for: the same expense
    // is often opened twice in a row while a correction is worked out.
    warmed.current.set(expense.id, cheques);
    setEditChequeOptions(cheques);
  }

  useNewEntry(() => setModal({ kind: "batch" }));

  return (
    <div className="flex h-full flex-col gap-2">
      <PageHeader
        title="Expenses"
        subtitle={`${shown.length} expense(s)${shown.length !== groups.length ? ` on ${groups.length} line(s)` : ""}${filtered ? " matching" : ""}`}
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
          if (group.members.length === 1) {
            const expense = group.members[0];
            if (expense.status === "posted" && !expense.documentId) openEdit(expense);
          }
          else setModal({ kind: "choose", group });
        }}
        // A line standing for several expenses has no single record to warm, and
        // fetching for all of them on a hover would cost more than the wait it
        // saves. Those are warmed from the chooser below instead, on the way past.
        // An expense with a linked document isn't editable here at all, so there
        // is nothing to fetch for it.
        onRowIntent={(row) => {
          const group = byRowId.get(String(row.id));
          if (!group || group.members.length !== 1) return;
          const expense = group.members[0];
          if (expense.status !== "posted" || expense.documentId) return;
          void warm(expense.id);
        }}
        pendingIds={pendingRowIds}
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
                  onClick={() => e.status === "posted" && !e.documentId && openEdit(e)}
                  onPointerEnter={() => e.status === "posted" && !e.documentId && void warm(e.id)}
                  onTouchStart={() => e.status === "posted" && !e.documentId && void warm(e.id)}
                  className="flex w-full items-baseline justify-between gap-4 border-b border-sand px-1 py-3 text-left hover:bg-brass-100"
                >
                  <span className="min-w-0 truncate text-ink">{e.notes ?? e.paymentMethod ?? "—"}{e.documentId ? " · linked document" : ""}</span>
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
        // Hidden rather than closed while this expense's write is in the air. A
        // hidden popup keeps everything typed and anything the server has to say
        // standing; a closed one would have thrown both away. `pending` empties
        // when the action settles, so a refusal brings the popup straight back,
        // and a success closes it for real from onDone.
        <Dialog title={modal.expense.category} onClose={close} hidden={pending.includes(modal.expense.id)}>
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
              onSaving={(formData) => {
                forgetWarm(modal.expense.id);
                patch(modal.expense.id, typedIntoExpense(formData));
              }}
            />
            <div className="rounded border border-error/30 bg-error-tint p-4">
              <DeleteExpenseButton
                expenseId={modal.expense.id}
                onDone={close}
                onDeleting={() => {
                  forgetWarm(modal.expense.id);
                  remove(modal.expense.id);
                }}
              />
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}
