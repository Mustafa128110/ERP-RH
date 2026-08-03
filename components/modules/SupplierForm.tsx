"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  updateContact,
  createContactsBatch,
  getContactsForEdit,
  updateContactsBatch,
  type ContactBatchRow,
  type ContactEditRow,
} from "@/lib/actions/contacts";
import { inputClass, labelClass, labelTextClass, submitClass, errorTextClass } from "@/components/ui/form-styles";
import { BatchAddDialog, batchCellClass, batchInputClass } from "@/components/ui/BatchAddDialog";
import { Dialog } from "@/components/ui/Dialog";
import { gridKeyDown, gridSelectionProps } from "@/components/ui/grid-keys";

type Option = { id: string; name: string };

type ContactDefaults = {
  displayName: string;
  companyId: string | null;
  companyName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  taxNumber: string | null;
  creditLimit: string | null;
  isActive: boolean | null;
};

export function ContactEditForm({
  companyOptions,
  contactId,
  defaults,
  onDone,
}: {
  companyOptions: Option[];
  contactId: string;
  defaults: ContactDefaults;
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState(updateContact.bind(null, contactId), undefined);
  const [displayName, setDisplayName] = useState(defaults?.displayName ?? "");

  useEffect(() => {
    if (!state?.success) return;
    onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.success]);

  return (
    <form action={action} className="flex flex-col gap-4">
      <label className={labelClass}>
        <span className={labelTextClass}>Name</span>
        <input name="displayName" type="text" required value={displayName} onChange={(e) => setDisplayName(e.target.value)} className={inputClass} />
      </label>
      <label className={labelClass}>
        <span className={labelTextClass}>Scope</span>
        <select name="companyId" defaultValue={defaults?.companyId ?? ""} className={inputClass}>
          <option value="">Global (all companies)</option>
          {companyOptions.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label className={labelClass}>
        <span className={labelTextClass}>Company Name</span>
        <input name="companyName" type="text" defaultValue={defaults?.companyName ?? ""} className={inputClass} />
      </label>
      <label className={labelClass}>
        <span className={labelTextClass}>Phone</span>
        <input name="phone" type="text" defaultValue={defaults?.phone ?? ""} className={inputClass} />
      </label>
      <label className={labelClass}>
        <span className={labelTextClass}>Email</span>
        <input name="email" type="email" defaultValue={defaults?.email ?? ""} className={inputClass} />
      </label>
      <label className={labelClass}>
        <span className={labelTextClass}>Address</span>
        <textarea
          name="address"
          rows={2}
          defaultValue={defaults?.address ?? ""}
          className="rounded border border-sand px-3 py-2 text-sm text-ink focus:border-navy-800"
        />
      </label>
      <label className={labelClass}>
        <span className={labelTextClass}>City</span>
        <input name="city" type="text" defaultValue={defaults?.city ?? ""} className={inputClass} />
      </label>
      <label className={labelClass}>
        <span className={labelTextClass}>Tax Number</span>
        <input name="taxNumber" type="text" defaultValue={defaults?.taxNumber ?? ""} className={inputClass} />
      </label>
      <label className={labelClass}>
        <span className={labelTextClass}>Credit Limit</span>
        <input name="creditLimit" type="number" min="0" step="0.01" defaultValue={defaults?.creditLimit ?? "0"} className={inputClass} />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input name="isActive" type="checkbox" defaultChecked={defaults?.isActive ?? true} className="h-5 w-5 rounded border-sand" />
        <span className={labelTextClass}>Active</span>
      </label>
      {state?.error && <p className={errorTextClass}>{state.error}</p>}
      <button type="submit" disabled={pending} className={submitClass}>
        {pending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}

type BatchRow = {
  displayName: string;
  companyId: string;
  companyName: string;
  phone: string;
  email: string;
  city: string;
  creditLimit: string;
};

const emptyBatchRow = (): BatchRow => ({
  displayName: "",
  companyId: "",
  companyName: "",
  phone: "",
  email: "",
  city: "",
  creditLimit: "0",
});

export type CreatedContact = { id: string; name: string; companyId: string | null };

export function ContactBatchAddDialog({
  companyOptions,
  onClose,
  onDone,
  initialRows,
}: {
  companyOptions: Option[];
  onClose: () => void;
  // Receives the created contacts so a quick-add can select one; the Contacts
  // page ignores the argument and just refreshes.
  onDone: (created?: CreatedContact[]) => void;
  initialRows?: number;
}) {
  return (
    <BatchAddDialog<BatchRow, CreatedContact>
      title="Add Contacts"
      onClose={onClose}
      onDone={onDone}
      initialRows={initialRows}
      emptyRow={emptyBatchRow}
      headers={["Name", "Scope", "Company Name", "Phone", "Email", "City", "Credit Limit"]}
      onSubmit={async (rows) => {
        const values: ContactBatchRow[] = rows.map((r) => ({
          displayName: r.displayName.trim(),
          companyId: r.companyId || null,
          companyName: r.companyName.trim() || null,
          phone: r.phone.trim() || null,
          email: r.email.trim() || null,
          address: null,
          city: r.city.trim() || null,
          taxNumber: null,
          creditLimit: r.creditLimit || "0",
          isActive: true,
        }));
        return createContactsBatch(values);
      }}
      renderRow={(row, i, update) => (
        <>
          <td className={batchCellClass}>
            <input value={row.displayName} onChange={(e) => update({ displayName: e.target.value })} className={batchInputClass} placeholder="Name" />
          </td>
          <td className={batchCellClass}>
            <select value={row.companyId} onChange={(e) => update({ companyId: e.target.value })} className={batchInputClass}>
              <option value="">Global (all companies)</option>
              {companyOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </td>
          <td className={batchCellClass}>
            <input value={row.companyName} onChange={(e) => update({ companyName: e.target.value })} className={batchInputClass} />
          </td>
          <td className={batchCellClass}>
            <input value={row.phone} onChange={(e) => update({ phone: e.target.value })} className={batchInputClass} />
          </td>
          <td className={batchCellClass}>
            <input value={row.email} onChange={(e) => update({ email: e.target.value })} className={batchInputClass} />
          </td>
          <td className={batchCellClass}>
            <input value={row.city} onChange={(e) => update({ city: e.target.value })} className={batchInputClass} />
          </td>
          <td className={batchCellClass}>
            <input
              type="number"
              min="0"
              step="0.01"
              value={row.creditLimit}
              onChange={(e) => update({ creditLimit: e.target.value })}
              className={batchInputClass}
            />
          </td>
        </>
      )}
    />
  );
}

// --- Edit ticked contacts together -----------------------------------------

// The mirror of ProductsBatchEditDialog, for contacts. A contact typed into a
// sale or purchase line is created name-only, so the list is full of rows with
// no phone, no city, no scope — the red dot marks them. Ticking those and
// opening them here puts every field of every one of them on screen at once,
// which is the only way filling a hundred of them in is not a hundred dialogs.
//
// Every column of the record is here, not just the empty ones: which fields are
// missing differs per row, and a grid with holes in it reads as "fill these in"
// on its own — the empty cells are tinted to say so.

const EDIT_HEADERS = [
  "Name",
  "Scope",
  "Company Name",
  "Phone",
  "Email",
  "Address",
  "City",
  "Tax Number",
  "Credit Limit",
  "Active",
];

// An empty cell in a row someone opened to complete is the thing they came for,
// so it says so rather than looking the same as a field that's deliberately blank.
const missingCell = (value: string | null) => `${batchCellClass} ${(value ?? "").trim() === "" ? "bg-brass-100" : ""}`;

export function ContactsBatchEditDialog({
  contactIds,
  companyOptions,
  onClose,
  onDone,
}: {
  contactIds: string[];
  // Already loaded by the contacts page for the add dialog — no reason to fetch
  // the same list again.
  companyOptions: Option[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [rows, setRows] = useState<ContactEditRow[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLTableSectionElement>(null);

  useEffect(() => {
    let cancelled = false;
    getContactsForEdit(contactIds)
      .then((loaded) => {
        if (cancelled) return;
        if (loaded.length === 0) setLoadError(true);
        else setRows(loaded);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
    // contactIds is a fresh array each render; the ids themselves are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactIds.join(",")]);

  function update(i: number, patch: Partial<ContactEditRow>) {
    setRows((prev) => (prev ? prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)) : prev));
  }

  // Takes the contact out of this edit. It doesn't delete anything — the row is
  // simply not among the ones saved.
  function removeRow(i: number) {
    setRows((prev) => (prev ? prev.filter((_, idx) => idx !== i) : prev));
  }

  async function submit() {
    if (!rows || rows.length === 0) return;
    setPending(true);
    setError(null);
    const result = await updateContactsBatch(rows);
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    onDone();
  }

  const count = rows?.length ?? contactIds.length;

  return (
    <Dialog
      title={`Edit ${count} contact${count === 1 ? "" : "s"}`}
      onClose={onClose}
      size="wide"
      footer={
        <div className="flex items-center justify-end gap-3">
          {error && <p className="text-sm text-error">{error}</p>}
          <button type="button" onClick={onClose} className="h-10 rounded px-4 text-sm text-steel hover:bg-ivory">
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={pending || !rows || rows.length === 0}
            className="h-10 rounded bg-navy-800 px-5 text-sm font-semibold text-white hover:bg-navy-700 disabled:opacity-40"
          >
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      }
    >
      {loadError ? (
        <p className={errorTextClass}>Couldn&apos;t load the selected contacts.</p>
      ) : !rows ? (
        <p className="text-sm text-steel">Loading…</p>
      ) : (
        <div className="scroll-thin overflow-auto rounded border border-sand">
          <table className="w-full min-w-max border-collapse text-sm">
            <thead>
              <tr className="sticky top-0 z-10 bg-ivory">
                {EDIT_HEADERS.map((h) => (
                  <th
                    key={h}
                    className="whitespace-nowrap border border-sand px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-steel"
                  >
                    {h}
                  </th>
                ))}
                <th className="w-8 border border-sand" />
              </tr>
            </thead>
            {/* Same keyboard model as every other grid in the app: arrows move,
                Ctrl+Enter saves. */}
            <tbody ref={bodyRef} {...gridSelectionProps} onKeyDown={(e) => gridKeyDown(e, bodyRef, () => !pending && void submit())}>
              {rows.map((row, i) => (
                <tr key={row.id}>
                  <td className={batchCellClass}>
                    <input
                      value={row.displayName}
                      onChange={(e) => update(i, { displayName: e.target.value })}
                      className={batchInputClass}
                      placeholder="Name"
                    />
                  </td>
                  <td className={batchCellClass}>
                    <select value={row.companyId ?? ""} onChange={(e) => update(i, { companyId: e.target.value || null })} className={batchInputClass}>
                      <option value="">Global (all companies)</option>
                      {companyOptions.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className={missingCell(row.companyName)}>
                    <input value={row.companyName ?? ""} onChange={(e) => update(i, { companyName: e.target.value })} className={batchInputClass} />
                  </td>
                  <td className={missingCell(row.phone)}>
                    <input value={row.phone ?? ""} onChange={(e) => update(i, { phone: e.target.value })} className={batchInputClass} />
                  </td>
                  <td className={missingCell(row.email)}>
                    <input type="email" value={row.email ?? ""} onChange={(e) => update(i, { email: e.target.value })} className={batchInputClass} />
                  </td>
                  <td className={missingCell(row.address)}>
                    <input value={row.address ?? ""} onChange={(e) => update(i, { address: e.target.value })} className={batchInputClass} />
                  </td>
                  <td className={missingCell(row.city)}>
                    <input value={row.city ?? ""} onChange={(e) => update(i, { city: e.target.value })} className={batchInputClass} />
                  </td>
                  <td className={missingCell(row.taxNumber)}>
                    <input value={row.taxNumber ?? ""} onChange={(e) => update(i, { taxNumber: e.target.value })} className={batchInputClass} />
                  </td>
                  <td className={batchCellClass}>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={row.creditLimit ?? "0"}
                      onChange={(e) => update(i, { creditLimit: e.target.value })}
                      className={batchInputClass}
                    />
                  </td>
                  <td className={`${batchCellClass} text-center`}>
                    <input
                      type="checkbox"
                      aria-label={`${row.displayName || "Contact"} active`}
                      checked={row.isActive ?? true}
                      onChange={(e) => update(i, { isActive: e.target.checked })}
                      className="h-4 w-4 rounded border-sand align-middle"
                    />
                  </td>
                  <td className="border border-sand text-center">
                    <button type="button" onClick={() => removeRow(i)} className="text-steel hover:text-error" aria-label={`Remove ${row.displayName}`}>
                      âœ•
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Dialog>
  );
}

