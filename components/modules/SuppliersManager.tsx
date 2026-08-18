"use client";

import { useState } from "react";
import { useNewEntry } from "@/components/layout/KeyboardShortcuts";
import { ContactEditForm, ContactBatchAddDialog, ContactsBatchEditDialog } from "@/components/modules/SupplierForm";
import { getContact } from "@/lib/actions/contacts";
import { Dialog } from "@/components/ui/Dialog";
import { DataTable } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { DetailHover } from "@/components/ui/DetailHover";
import { iconButtonClass, primaryIconButtonClass } from "@/components/ui/form-styles";
import { Icon } from "@/components/ui/Icon";
import type { ColumnDef, Row } from "@/lib/table";

const columns: ColumnDef[] = [
  {
    key: "displayName",
    label: "Name",
    // Balance and last activity: what you want to know about a contact before
    // deciding whether to open them. The columns already show how to reach them.
    render: (row) => (
      <DetailHover
        trigger={String(row.displayName)}
        heading={String(row.displayName)}
        width={296}
        rows={[
          ...(row.owesUs ? [{ label: "Owes us", value: String(row.owesUs) }] : []),
          ...(row.weOwe ? [{ label: "We owe", value: String(row.weOwe) }] : []),
          ...(!row.owesUs && !row.weOwe ? [{ label: "Balance", value: "Settled" }] : []),
          { label: "Invoices", value: String(row.documentCount ?? 0) },
          ...(row.lastDocument ? [{ label: "Last document", value: String(row.lastDocument) }] : []),
          { label: "Credit limit", value: String(row.creditLimit) },
          ...(row.taxNumber ? [{ label: "Tax number", value: String(row.taxNumber) }] : []),
        ]}
        footer={row.address ? String(row.address) : undefined}
        extraHeight={row.address ? 16 : 0}
      />
    ),
  },
  { key: "company", label: "Scope", badge: true },
  { key: "companyName", label: "Company Name" },
  { key: "phone", label: "Phone" },
  { key: "email", label: "Email" },
  { key: "city", label: "City" },
  { key: "creditLimit", label: "Credit Limit", align: "right" },
  { key: "status", label: "Status", badge: true },
];

type Option = { id: string; name: string };
type ContactDetail = Awaited<ReturnType<typeof getContact>> | null;
type ModalState = { kind: "batch" } | { kind: "edit"; id: string } | { kind: "batchEdit" } | null;

export function SuppliersManager({ rows, companyOptions }: { rows: Row[]; companyOptions: Option[] }) {
  const [modal, setModal] = useState<ModalState>(null);
  // The table only carries display columns; the full record is fetched when a
  // row is opened, so the list query stays light.
  const [detail, setDetail] = useState<ContactDetail>(null);
  // Contacts created name-only from a sale or purchase line are the reason this
  // exists — tick the half-filled ones and finish them in one grid instead of
  // opening each in turn. Same tick column and Ctrl+Enter as the products list.
  const [selected, setSelected] = useState<string[]>([]);

  function close() {
    setModal(null);
    setDetail(null);
  }

  function closeBatchEdit() {
    setModal(null);
    // The saved rows are no longer the ones that needed fixing, so leaving them
    // ticked invites a second pass over work already done.
    setSelected([]);
  }

  async function openEdit(row: Row) {
    const id = String(row.id);
    setModal({ kind: "edit", id });
    setDetail(await getContact(id));
  }

  useNewEntry(() => setModal({ kind: "batch" }));

  return (
    <div className="flex h-full flex-col gap-2">
      <PageHeader
        title="Contacts"
        subtitle={selected.length > 0 ? `${selected.length} of ${rows.length} contact(s) selected` : `${rows.length} contact(s)`}
      >
        <button
          type="button"
          onClick={() => setModal({ kind: "batchEdit" })}
          disabled={selected.length === 0}
          aria-label={selected.length === 0 ? "Edit selected contacts" : `Edit ${selected.length} selected contact(s)`}
          title={selected.length === 0 ? "Tick the contacts you want to edit" : `Edit ${selected.length} selected`}
          // Widens to fit the count rather than staying square: the number is
          // the answer to "did it register my ticks", which the icon can't give.
          className={`${iconButtonClass} ${selected.length > 0 ? "w-auto gap-1.5 px-3" : ""}`}
        >
          <Icon name="edit" />
          {selected.length > 0 && <span className="text-sm font-medium tabular-nums">{selected.length}</span>}
        </button>
        <button
          type="button"
          onClick={() => setModal({ kind: "batch" })}
          className={primaryIconButtonClass}
          aria-label="Add contacts"
          title="Add contacts — Alt+N"
        >
          <Icon name="plus" />
        </button>
      </PageHeader>

      {/* Ticking is the batch route, a plain click still opens the one row —
          a modified click selects instead of opening (DataTable handles that). */}
      <DataTable
        columns={columns}
        rows={rows}
        idKey="id"
        onRowClick={openEdit}
        selected={selected}
        onSelectedChange={setSelected}
        onBatchEdit={() => setModal({ kind: "batchEdit" })}
        searchPlaceholder="Search contacts…"
      />

      {modal?.kind === "batch" && <ContactBatchAddDialog companyOptions={companyOptions} onClose={() => setModal(null)} onDone={close} />}

      {modal?.kind === "batchEdit" && (
        <ContactsBatchEditDialog
          contactIds={selected}
          companyOptions={companyOptions}
          onClose={() => setModal(null)}
          onDone={closeBatchEdit}
        />
      )}

      {modal?.kind === "edit" && (
        <Dialog title={detail?.displayName ?? "Edit Contact"} onClose={close}>
          {detail ? (
            <ContactEditForm companyOptions={companyOptions} contactId={modal.id} defaults={detail} onDone={close} />
          ) : (
            <p className="text-sm text-steel">Loading…</p>
          )}
        </Dialog>
      )}
    </div>
  );
}
