"use client";

import { useRef, useState } from "react";
import { formatDate, toISODate } from "@/lib/format";

// Every date on screen is DD-MM-YYYY. A bare <input type="date"> can't be told
// that — it renders in the browser's locale, so the same field read dd/mm/yyyy
// on one machine and mm/dd/yyyy on the next — so the visible box is a text
// input in our format, with a real date input kept alongside purely to open the
// platform date picker.
//
// The value crossing the wire is still ISO: `name` goes on a hidden field
// holding YYYY-MM-DD, which is what the server actions and Postgres `date`
// columns already expect. Nothing downstream changes.
//
// ponytail: text + hidden pair rather than a calendar widget. The native picker
// still does the picking; this only owns the formatting.
export function DateField({
  name,
  value,
  defaultValue,
  onChange,
  required,
  className = "",
  "aria-label": ariaLabel,
}: {
  name?: string;
  // ISO (YYYY-MM-DD). Controlled when `value` is passed, uncontrolled otherwise.
  value?: string;
  defaultValue?: string;
  onChange?: (iso: string) => void;
  required?: boolean;
  className?: string;
  "aria-label"?: string;
}) {
  const [ownIso, setOwnIso] = useState(defaultValue ?? "");
  const iso = value ?? ownIso;
  // What's in the box while it's being typed. Only re-derived from `iso` when
  // the value changed from outside, so "1-" doesn't get rewritten mid-keystroke.
  //
  // What's tracked is the last value that came *in*, never the last one emitted.
  // `set` used to record what it sent, which read as "outside changed" on the
  // very next render — harmless where the parent applies the change
  // synchronously (a batch grid row), but the filter bar answers by pushing a
  // URL, and for the round trip that took, a typed date was wiped out of the box
  // it had just been typed into. It looked like the date filter didn't work.
  const [lastValue, setLastValue] = useState(iso);
  const [text, setText] = useState(() => (iso ? formatDate(iso) : ""));
  if (iso !== lastValue) {
    setLastValue(iso);
    setText(iso ? formatDate(iso) : "");
  }

  const pickerRef = useRef<HTMLInputElement>(null);

  function set(nextIso: string) {
    if (value === undefined) setOwnIso(nextIso);
    onChange?.(nextIso);
  }

  // Digits only, dashes inserted as you pass each boundary — so 25122026 types
  // itself into 25-12-2026 and a paste of either form lands correctly.
  function onType(raw: string) {
    const digits = raw.replace(/\D/g, "").slice(0, 8);
    const parts = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)].filter(Boolean);
    const next = parts.join("-");
    setText(next);
    const nextIso = toISODate(next);
    // A half-typed date clears the stored value rather than keeping the old one
    // — required fields then fail validation instead of saving yesterday.
    if (nextIso || next === "") set(nextIso);
  }

  return (
    <span className="relative inline-flex w-full items-center">
      {/* Validation sits on the visible box, not on the hidden ISO field: the
          browser refuses to report a problem on a control it can't scroll to
          and focus, which silently blocks the whole form. The pattern is the
          format this field is documented to take. */}
      <input
        type="text"
        inputMode="numeric"
        placeholder="DD-MM-YYYY"
        aria-label={ariaLabel}
        required={required}
        pattern="\d{1,2}-\d{1,2}-\d{4}"
        title="DD-MM-YYYY"
        value={text}
        onChange={(e) => onType(e.target.value)}
        className={`w-full pr-9 ${className}`}
      />
      {name && <input type="hidden" name={name} value={iso} />}
      {/* Kept at a real size (behind the button) rather than zero-width:
          showPicker() refuses to open for an element that isn't being
          rendered. */}
      <input
        ref={pickerRef}
        type="date"
        tabIndex={-1}
        aria-hidden
        value={iso}
        onChange={(e) => {
          set(e.target.value);
          setText(e.target.value ? formatDate(e.target.value) : "");
        }}
        className="pointer-events-none absolute right-1 h-7 w-7 opacity-0"
      />
      <button
        type="button"
        aria-label="Open date picker"
        onClick={() => {
          const el = pickerRef.current;
          if (!el) return;
          try {
            el.showPicker();
          } catch {
            // No showPicker (older Safari): typing still works, which is the
            // primary path here anyway.
          }
        }}
        className="absolute right-1 flex h-7 w-7 items-center justify-center rounded text-steel hover:bg-ivory hover:text-navy-800"
      >
        📅
      </button>
    </span>
  );
}
