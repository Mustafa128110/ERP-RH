"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Dialog } from "@/components/ui/Dialog";
import { DateField } from "@/components/ui/DateField";
import { formatDate, todayISO } from "@/lib/format";
import { submitClass, secondaryActionClass, labelClass, labelTextClass, inputClass, errorTextClass } from "@/components/ui/form-styles";

// One button that says what range the list is showing, and a popup to change it.
//
// It replaced two loose date boxes sitting in the filter bar. Those navigated on
// every completed date, so setting a range was two round trips with a re-render
// between them, and asking for a single day meant typing the same date twice
// into two different boxes. Here the dates are picked locally and applied in one
// navigation, and a single day is the mode it opens in.
//
// `from` and `to` are the same query params as before, so every page reading
// them is untouched.
export function DateRangeFilter() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";

  const [open, setOpen] = useState(false);
  // Drafts, so nothing is applied until Apply — Esc or the backdrop leaves the
  // list exactly as it was.
  const [single, setSingle] = useState(true);
  const [draftFrom, setDraftFrom] = useState("");
  const [draftTo, setDraftTo] = useState("");
  const [error, setError] = useState("");

  function openPopup() {
    // A range already on the URL opens in range mode; one day (or nothing) opens
    // on the single-day tab, which is the more common ask.
    setSingle(!from || !to || from === to);
    setDraftFrom(from);
    setDraftTo(to);
    setError("");
    setOpen(true);
  }

  function push(nextFrom: string, nextTo: string) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of [
      ["from", nextFrom],
      ["to", nextTo],
    ]) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    router.push(params.size > 0 ? `${pathname}?${params.toString()}` : pathname);
    setOpen(false);
  }

  function apply() {
    // A single day is the range that starts and ends on it — the pages filter on
    // `from`/`to` and know nothing about "one day".
    if (single) {
      if (!draftFrom) return setError("Pick a date, or clear the filter.");
      return push(draftFrom, draftFrom);
    }
    // Either end may be left empty: "everything since March", "everything up to
    // year end". Both empty is no date filter at all.
    if (draftFrom && draftTo && draftFrom > draftTo) return setError("The end date is before the start date.");
    push(draftFrom, draftTo);
  }

  const label =
    !from && !to ? "All dates"
    : from && from === to ? formatDate(from)
    : from && to ? `${formatDate(from)} – ${formatDate(to)}`
    : from ? `From ${formatDate(from)}`
    : `Until ${formatDate(to)}`;

  const tabClass = (active: boolean) =>
    `h-11 flex-1 rounded-md border px-3 text-sm font-medium sm:h-10 ${
      active ? "border-navy-800 bg-navy-100 text-navy-800" : "border-sand text-steel hover:text-navy-800"
    }`;

  return (
    <>
      <button
        type="button"
        onClick={openPopup}
        // Reads as "set" rather than "empty" once a range is on, so the bar shows
        // at a glance that the list is not the whole list.
        className={`h-11 rounded-md border px-3 text-base sm:h-10 sm:text-sm ${
          from || to ? "border-navy-800 bg-navy-100 font-medium text-navy-800" : "border-sand text-ink"
        }`}
      >
        📅 {label}
      </button>

      {open && (
        <Dialog
          title="Filter by date"
          onClose={() => setOpen(false)}
          footer={
            <div className="flex items-center justify-between gap-3">
              <button type="button" onClick={() => push("", "")} className={secondaryActionClass}>
                Clear dates
              </button>
              {/* data-dialog-submit: this dialog has no form (Apply is a
                  function), so the app-wide Ctrl+Enter handler clicks this
                  button from anywhere in the dialog body. */}
              <button type="button" onClick={apply} data-dialog-submit className={submitClass}>
                Apply
              </button>
            </div>
          }
        >
          <div className="flex flex-col gap-4">
            <div className="flex gap-2">
              <button type="button" onClick={() => { setSingle(true); setError(""); }} className={tabClass(single)}>
                A single day
              </button>
              <button type="button" onClick={() => { setSingle(false); setError(""); }} className={tabClass(!single)}>
                A range
              </button>
            </div>

            {single ? (
              <>
                <label className={labelClass}>
                  <span className={labelTextClass}>Date</span>
                  <DateField value={draftFrom} onChange={setDraftFrom} className={inputClass} aria-label="Date" />
                </label>
                <button type="button" onClick={() => push(todayISO(), todayISO())} className={secondaryActionClass}>
                  Today
                </button>
              </>
            ) : (
              <>
                <label className={labelClass}>
                  <span className={labelTextClass}>From</span>
                  <DateField value={draftFrom} onChange={setDraftFrom} className={inputClass} aria-label="From date" />
                </label>
                <label className={labelClass}>
                  <span className={labelTextClass}>To</span>
                  <DateField value={draftTo} onChange={setDraftTo} className={inputClass} aria-label="To date" />
                </label>
                <p className="text-xs text-steel">Leave either side empty for an open-ended range.</p>
              </>
            )}

            {error && <p className={errorTextClass}>{error}</p>}
          </div>
        </Dialog>
      )}
    </>
  );
}
