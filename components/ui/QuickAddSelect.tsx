"use client";

import { useState, type ReactNode } from "react";
import { quickAddButtonClass, secondaryActionClass } from "@/components/ui/form-styles";

export type SelectOption = { id: string; name: string };

// The toolbar counterpart to QuickAddSelect, for batch tables. A row's dropdowns
// (a product's category, a product's brand) share one option list across every
// row, so a per-cell "+" would be one button per cell for no benefit. Instead a
// single labelled button sits above the table; whatever it creates is appended
// to the shared options and becomes selectable in every row.
export function QuickAddButton<T extends SelectOption = SelectOption>({
  label,
  onCreated,
  renderDialog,
}: {
  label: string;
  onCreated: (created: T[]) => void;
  renderDialog: (args: { onClose: () => void; onCreated: (created: T[]) => void }) => ReactNode;
}) {
  const [open, setOpen] = useState<boolean>(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={secondaryActionClass}>
        {label}
      </button>
      {open &&
        renderDialog({
          onClose: () => setOpen(false),
          onCreated: (rows) => {
            if (rows.length > 0) onCreated(rows);
            setOpen(false);
          },
        })}
    </>
  );
}

// A labelled dropdown with a "+" beside it that opens the create-popup for
// whatever the dropdown points at — pick an existing item, or make one on the
// spot without losing the form you're in. Used for every field that references
// another record you might not have created yet (item, unit, contact, category,
// brand, location, currency…). Company is deliberately excluded: it's picked
// once and set up elsewhere, not created mid-flow.
//
// The dialog is supplied by the caller through `renderDialog`, because each
// entity's create-popup needs its own props (companyOptions and so on). This
// component only owns the three things that are the same every time: the
// dropdown, the "+", and folding a freshly-created record back in — appended to
// the options and selected, so the field ends up filled.
//
// Controlled: the parent owns `value`, so it can read it back on submit and so
// selecting a new record updates the field. Newly created records are held in
// local state and merged on top of `options`, which keeps the caller from
// having to thread option state back up just to remember them.
export function QuickAddSelect({
  label,
  name,
  value,
  onChange,
  options,
  required,
  noneLabel,
  placeholder,
  format = (o) => o.name,
  renderDialog,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  required?: boolean;
  // When set, the dropdown offers a "none" choice with this label (optional
  // references like a location). Omit for required references.
  noneLabel?: string;
  placeholder?: string;
  // How to display an option — e.g. items show "SKU — Name", units "Name (kg)".
  format?: (option: SelectOption) => string;
  renderDialog: (args: { onClose: () => void; onCreated: (created: SelectOption[]) => void }) => ReactNode;
}) {
  const [created, setCreated] = useState<SelectOption[]>([]);
  const [open, setOpen] = useState(false);

  // Freshly-created records first so they're easy to spot after adding.
  const allOptions = [...created, ...options];

  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-ink">{label}</span>
      <div className="flex gap-1.5">
        <select
          name={name}
          required={required}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-12 min-w-0 flex-1 rounded border border-sand px-3 text-base text-ink focus:border-navy-800"
        >
          {noneLabel ? (
            <option value="">{noneLabel}</option>
          ) : (
            <option value="" disabled>
              {options.length === 0 ? "None yet — add one with +" : (placeholder ?? "Select")}
            </option>
          )}
          {allOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {format(o)}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => setOpen(true)} className={quickAddButtonClass} title={`Add ${label.toLowerCase()}`}>
          +
        </button>
      </div>

      {open &&
        renderDialog({
          onClose: () => setOpen(false),
          onCreated: (rows) => {
            if (rows.length > 0) {
              setCreated((prev) => [...rows, ...prev]);
              onChange(rows[0].id);
            }
            setOpen(false);
          },
        })}
    </label>
  );
}
