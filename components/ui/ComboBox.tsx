"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { InputHTMLAttributes, KeyboardEvent } from "react";
import { filterPickerOptions, pickerWindow, PICKER_ROW_HEIGHT, PICKER_HEIGHT } from "@/lib/picker-window";

export type ComboOption = { id: string; name: string };

// InputHTMLAttributes plus data-* passthrough (used for the grid's data-cell).
type ComboInputProps = InputHTMLAttributes<HTMLInputElement> & { [dataAttr: `data-${string}`]: string | number };

// A proper typeahead dropdown: styled list, filters as you type, keyboard
// driven, and still accepts free text (the caller resolves the id from the
// name, and unmatched text is created on save). Ctrl/Alt + ArrowDown opens it.
// When closed, arrow keys fall through to `inputProps.onKeyDown` so it composes
// with the sales/purchase grid navigation.
export function ComboBox({
  value,
  onChange,
  options,
  placeholder,
  className,
  inputProps,
}: {
  value: string;
  onChange: (name: string) => void;
  options: ComboOption[];
  placeholder?: string;
  className?: string;
  inputProps?: ComboInputProps;
}) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  const [scrollTop, setScrollTop] = useState(0);

  const q = value.trim().toLowerCase();
  const filtered = useMemo(() => !open ? [] : filterPickerOptions(options, q), [open, q, options]);
  const visibleWindow = pickerWindow(filtered.length, scrollTop);

  function place() {
    const r = inputRef.current?.getBoundingClientRect();
    if (r) setRect({ top: r.bottom, left: r.left, width: r.width });
  }
  function openList() {
    place();
    setHighlight(0);
    setScrollTop(0);
    setOpen(true);
  }

  // Position is fixed (to escape the table's overflow clip), so a scroll or
  // resize would leave the list floating — close it instead of chasing.
  //
  // The scroll listener has to be capture-phase to see scrolls on ancestors,
  // which means it also sees the list's own overflow scrolling — so wheeling the
  // list closed it before you could reach anything below the visible slice.
  // Scrolls originating inside the list are its own business.
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onScroll = (e: Event) => {
      if (e.target instanceof Node && listRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  // Arrowing through the options moves the highlight, which can walk past the
  // bottom of the 14rem window — bring it along.
  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    if (!list) return;
    const top = highlight * PICKER_ROW_HEIGHT;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (top + PICKER_ROW_HEIGHT > list.scrollTop + PICKER_HEIGHT) list.scrollTop = top + PICKER_ROW_HEIGHT - PICKER_HEIGHT;
  }, [highlight, open]);

  function select(o: ComboOption) {
    onChange(o.name);
    setOpen(false);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (open) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlight((h) => Math.min(h + 1, filtered.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlight((h) => Math.max(h - 1, 0));
        return;
      }
      // Ctrl+Enter is "save the whole grid", not "accept this suggestion" — let
      // it through to whatever owns the form.
      if (e.key === "Enter" && !e.ctrlKey && !e.metaKey && filtered[highlight]) {
        e.preventDefault();
        select(filtered[highlight]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        return;
      }
      // Arrowing sideways out of a half-typed name accepts the highlighted option
      // rather than leaving the raw text behind — that text resolves to a brand
      // new item on save, which is not what "cem<right>" meant. Only at the text
      // edge: mid-text the arrow belongs to the caret. Falls through afterwards so
      // the grid still moves to the next cell.
      if ((e.key === "ArrowRight" || e.key === "ArrowLeft") && filtered[highlight]) {
        const el = e.currentTarget;
        const atEdge = e.key === "ArrowRight" ? el.selectionEnd === el.value.length : el.selectionStart === 0;
        if (atEdge) select(filtered[highlight]);
      }
      if (e.key === "Tab") setOpen(false);
    } else if ((e.ctrlKey || e.altKey) && e.key === "ArrowDown") {
      e.preventDefault();
      openList();
      return;
    }
    inputProps?.onKeyDown?.(e);
  }

  return (
    <>
      <input
        {...inputProps}
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        className={className}
        onChange={(e) => {
          onChange(e.target.value);
          setHighlight(0);
          setScrollTop(0);
          if (listRef.current) listRef.current.scrollTop = 0;
          if (!open) openList();
          else place();
        }}
        onClick={() => {
          if (!open) openList();
        }}
        onKeyDown={handleKeyDown}
        onBlur={(e) => {
          // Delay so a click on an option registers before the list unmounts.
          window.setTimeout(() => setOpen(false), 120);
          inputProps?.onBlur?.(e);
        }}
      />
      {open && rect && filtered.length > 0 && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          onScroll={event => setScrollTop(event.currentTarget.scrollTop)}
          style={{ position: "fixed", top: rect.top, left: rect.left, width: rect.width, zIndex: 60, maxHeight: PICKER_HEIGHT }}
          className="scroll-thin mt-1 overflow-auto rounded-md border border-sand bg-white text-sm shadow-lg"
        >
          <li aria-hidden style={{ height: visibleWindow.first * PICKER_ROW_HEIGHT }} />
          {filtered.slice(visibleWindow.first, visibleWindow.last).map((o, offset) => {
            const i = visibleWindow.first + offset;
            return (
            <li key={o.id}>
              <button
                type="button"
                role="option"
                aria-selected={i === highlight}
                aria-posinset={i + 1}
                aria-setsize={filtered.length}
                title={o.name}
                style={{ height: PICKER_ROW_HEIGHT }}
                data-idx={i}
                onMouseDown={(e) => {
                  e.preventDefault();
                  select(o);
                }}
                onMouseEnter={() => setHighlight(i)}
                className={`block w-full truncate px-3 text-left ${i === highlight ? "bg-navy-800 text-white" : "text-ink hover:bg-ivory"}`}
              >
                {o.name}
              </button>
            </li>
          ); })}
          <li aria-hidden style={{ height: (filtered.length - visibleWindow.last) * PICKER_ROW_HEIGHT }} />
        </ul>
      )}
    </>
  );
}
