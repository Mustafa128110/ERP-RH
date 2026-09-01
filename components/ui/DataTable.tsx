"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ColumnDef, Row } from "@/lib/table";
import { StatusPill } from "./StatusPill";
import { Icon } from "./Icon";
import { iconButtonClass } from "./form-styles";
import { matchesTableSearch, parseTableSearch } from "@/lib/search-query";
import { compareTableValues, tableColumnSortKey } from "@/lib/table-sort";

// Every list gets a row number in front, so a row can be pointed at out loud
// ("line 14") without reading its contents back. It's synthesised rather than a
// real column — the count is the row's position on screen, not data anyone stores.
const SNO_KEY = "__sno";
const snoColumn: ColumnDef = { key: SNO_KEY, label: "#", align: "right" };

// Keys that exist to drive rendering rather than to be read — searching them
// would match "true" against a typed "tru".
const HIDDEN_KEYS = new Set(["id", "_incomplete", "_ruleIds", "_baseUnitId"]);

// What a row matches against: every value on it that a human could read. Built
// once per row per render of the list, not once per keystroke per row.
function haystack(row: Row): string {
  let text = "";
  for (const key in row) {
    if (HIDDEN_KEYS.has(key)) continue;
    const value = row[key];
    if (value === null || typeof value === "boolean") continue;
    text += `${String(value).toLowerCase()}\u001f`;
  }
  return text;
}

// The table is a client component so one keyboard model serves every list:
//
//   ↑ / ↓            move the highlight
//   Home / End       first / last row
//   PageUp/PageDown  ten rows at a time
//   Enter            tick the highlighted row (or open it, on a list with no
//                    tick column)
//   Shift + ↑/↓      extend the ticked range from where it started
//   Ctrl + Enter     open the batch edit for what's ticked
//   /                jump to the search box (when the list has one)
//   Esc              clear the search and come back to the rows
//
// Server pages therefore pass `hrefBase` (a string) rather than a rowHref
// function — a function prop can't cross the server/client boundary, and every
// caller was building the same `${base}/${id}` anyway.
export function DataTable({
  columns,
  rows,
  idKey,
  hrefBase,
  onRowClick,
  emptyMessage,
  selected,
  onSelectedChange,
  onBatchEdit,
  searchPlaceholder,
  storageKey,
  pendingIds,
  onRowIntent,
}: {
  columns: ColumnDef[];
  rows: Row[];
  idKey: string;
  // Row link target: `${hrefBase}/${row[idKey]}`.
  hrefBase?: string;
  onRowClick?: (row: Row) => void;
  emptyMessage?: string;
  // Opt-in: pass both and the table grows a tick column in front, with a
  // select-all in the header. Lists that don't act on a selection stay as they
  // were — no column, no header checkbox.
  selected?: string[];
  onSelectedChange?: (ids: string[]) => void;
  // Ctrl+Enter on a selection. Only offered where a batch dialog exists.
  onBatchEdit?: () => void;
  // Pass a placeholder and the list grows a search box. Filtering is done here,
  // over rows the page already sent — no round trip, so it narrows as fast as
  // the keys are pressed. Lists whose filtering has to happen in the database
  // (payments, invoices — they filter by date range and status through the URL)
  // keep using ListFilters instead; this is for "find the row I can see".
  searchPlaceholder?: string;
  // Optional key for localStorage persistence of sort state. When provided,
  // the sort column and direction are saved and restored across page loads.
  storageKey?: string;
  // Rows whose write is still in the air (lib/use-optimistic-records). They are
  // already showing the edited values — this only says so, by fading them until
  // the database has agreed (tr[data-pending] in globals.css). An array rather
  // than a Set because it holds one or two ids in practice, and building a Set
  // every render to answer that costs more than the scan does.
  pendingIds?: readonly string[];
  // Called when a pointer settles on a row, before any click. Lists whose rows
  // open a detail fetched on click (invoices, purchases, payments) use it to warm
  // that fetch, the way IntentLink warms a navigation — see the managers.
  //
  // Pointer and touch only, deliberately: arrow-keying past forty rows is not
  // intent, and firing a round trip for each one would be worse than the wait it
  // was meant to remove. A keyboard open pays the same cost it always did.
  onRowIntent?: (row: Row) => void;
}) {
  const router = useRouter();
  // Which row the highlight is on, and where a Shift-extended range started.
  // -1 until the list is actually used: an untouched page shouldn't already be
  // pointing at its first row.
  const [focused, setFocused] = useState(-1);
  const [query, setQuery] = useState("");
  // The search box is a search icon until it is asked for. On a list screen the
  // box was permanently occupying a strip of the header for a thing that is
  // typed into occasionally; "/" and the icon both bring it back.
  const [searchOpen, setSearchOpen] = useState(false);

  // Load sort state from localStorage if storageKey is provided
  const [sortKey, setSortKey] = useState<string | null>(() => {
    if (storageKey && typeof window !== "undefined") {
      const saved = localStorage.getItem(`datatable-sort-${storageKey}`);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          return parsed.key ?? null;
        } catch {
          return null;
        }
      }
    }
    return null;
  });

  const [sortDir, setSortDir] = useState<"asc" | "desc">(() => {
    if (storageKey && typeof window !== "undefined") {
      const saved = localStorage.getItem(`datatable-sort-${storageKey}`);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          return parsed.dir ?? "desc";
        } catch {
          return "desc";
        }
      }
    }
    return "desc";
  });

  // Save sort state to localStorage when it changes
  useEffect(() => {
    if (storageKey && typeof window !== "undefined") {
      localStorage.setItem(`datatable-sort-${storageKey}`, JSON.stringify({ key: sortKey, dir: sortDir }));
    }
  }, [storageKey, sortKey, sortDir]);
  const anchor = useRef(0);
  const bodyRef = useRef<HTMLTableSectionElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Recomputed only when the rows themselves change, so typing filters against
  // a prepared index rather than re-stringifying every row on every keystroke.
  const index = useMemo(() => rows.map(haystack), [rows]);

  // Plain space- or comma-separated words retain the broad all-fields search.
  // A field prefix narrows just that term: unit:dozen cannot match a contact
  // merely because the contact's name happens to contain "dozen".
  const terms = parseTableSearch(query.replaceAll(",", " "));
  const visible = useMemo(() => {
    let result = terms.length === 0 ? rows : rows.filter((row, i) => matchesTableSearch(row, index[i], terms));
    if (sortKey) {
      result = [...result].sort((a, b) => {
        const av = a[sortKey];
        const bv = b[sortKey];
        return compareTableValues(av, bv, sortDir);
      });
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, index, query, sortKey, sortDir]);

  function toggleSort(key: string) {
    if (sortKey === key) {
      // Third click: clear sort
      if (sortDir === "asc") {
        setSortKey(null);
        setSortDir("desc");
      } else {
        setSortDir("asc");
      }
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  // A highlight left pointing at row 40 of a list that just narrowed to three
  // would scroll to nothing and Enter would open the wrong record. Done where
  // the query changes rather than in an effect watching it: the search box is
  // the only thing that can change it, so an effect would just be a slower way
  // of saying the same thing (and a second render to say it in).
  function runSearch(next: string) {
    setQuery(next);
    setFocused(-1);
    anchor.current = 0;
    scrollRef.current?.scrollTo({ top: 0 });
  }

  const selectable = selected !== undefined && onSelectedChange !== undefined;
  const selectedSet = new Set(selected ?? []);
  // Ids of what's on screen. Select-all ticks the filtered set, which is what
  // "search for the ones that need fixing, then tick them all" needs it to mean.
  const allIds = visible.map((row) => String(row[idKey]));
  const allSelected = selectable && allIds.length > 0 && allIds.every((id) => selectedSet.has(id));

  function toggle(id: string) {
    const next = new Set(selectedSet);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectedChange!([...next]);
  }

  // Everything between the anchor and `to`, added to whatever was already
  // ticked — the same rule a file manager follows.
  function selectRange(to: number, additive: boolean) {
    const [lo, hi] = anchor.current <= to ? [anchor.current, to] : [to, anchor.current];
    const range = allIds.slice(lo, hi + 1);
    onSelectedChange!(additive ? [...new Set([...(selected ?? []), ...range])] : range);
  }

  // `focused` indexes the full filtered list, which is also the complete set
  // rendered in the table.
  function moveTo(index: number) {
    const clamped = Math.max(0, Math.min(visible.length - 1, index));
    setFocused(clamped);
    return clamped;
  }

  // Scrolling happens after the focused row has rendered.
  useEffect(() => {
    if (focused < 0) return;
    bodyRef.current?.children[focused]?.scrollIntoView({ block: "nearest" });
  }, [focused]);

  function open(row: Row) {
    if (onRowClick) onRowClick(row);
    else if (hrefBase) router.push(`${hrefBase}/${row[idKey]}`);
  }

  function onKeyDown(e: globalThis.KeyboardEvent) {
    // A control inside a cell (the tick box, a filter) owns its own keys.
    if (e.target instanceof HTMLInputElement && e.target.type !== "checkbox") return;

    // "/" is the search key everywhere it exists — the same reflex as a browser
    // find, without stealing Ctrl+F from the browser itself.
    if (searchPlaceholder && e.key === "/" && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      setSearchOpen(true);
      // The box may not be mounted yet on the first "/" of a page's life.
      requestAnimationFrame(() => searchRef.current?.focus());
      return;
    }

    if (visible.length === 0) return;
    // First key press lands on the top row rather than nowhere.
    const at = focused < 0 ? 0 : focused;

    if (e.key === "Enter") {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        if (onBatchEdit && selectedSet.size > 0) onBatchEdit();
        return;
      }
      if (focused < 0) {
        moveTo(0);
        anchor.current = 0;
        return;
      }
      if (selectable) {
        anchor.current = at;
        toggle(allIds[at]);
      } else {
        open(visible[at]);
      }
      return;
    }

    const step =
      e.key === "ArrowDown" ? 1
      : e.key === "ArrowUp" ? -1
      : e.key === "PageDown" ? 10
      : e.key === "PageUp" ? -10
      : 0;
    const target =
      step !== 0 ? (focused < 0 ? 0 : at + step)
      : e.key === "Home" ? 0
      : e.key === "End" ? visible.length - 1
      : null;
    if (target === null) return;

    e.preventDefault();
    const next = moveTo(target);
    // Shift drags the selection along with it.
    if (selectable && e.shiftKey) selectRange(next, false);
    else anchor.current = next;
  }

  // The arrow keys used to require clicking the table first, because the
  // handler hung off a focusable div. On a screen whose entire purpose is the
  // list, having to click the list before it answers the keyboard is a step
  // that exists only to satisfy the implementation. Bound to the document
  // instead, with the guards that focus used to provide for free:
  //
  //   - anything typed into a field, a textarea or a contenteditable is theirs
  //   - a modal on top owns the keyboard completely; the list behind it is not
  //     what the arrows are for
  //   - if a page somehow holds two of these, only the first answers, or both
  //     would move on one press
  useEffect(() => {
    function handler(e: globalThis.KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target?.isContentEditable) return;
      const tag = target?.tagName;
      if (tag === "TEXTAREA" || tag === "SELECT") return;
      if (tag === "INPUT" && (target as HTMLInputElement).type !== "checkbox") {
        // Except Escape and ArrowDown out of this table's own search box, which
        // the input's own handler deals with.
        return;
      }
      if (document.querySelector('[role="dialog"]')) return;
      if (document.querySelector("[data-list]") !== scrollRef.current) return;
      onKeyDown(e);
    }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
    // Deliberately no dependency array: onKeyDown closes over focused, visible
    // and the selection, and a listener registered once would go on reading
    // the first render's copies of all three.
  });

  function onRowMouseDown(index: number) {
    setFocused(index);
    if (!selectable) return;
    anchor.current = index;
  }

  // Sits above the table rather than in the page header, so it stays with the
  // rows it filters and every list gets it from one prop instead of fifteen
  // pages each wiring their own.
  // Collapsed to its icon until wanted. Stays open while a query is live — a
  // box that folded away and took the filter's only visible explanation with it
  // would leave a list showing 12 of 400 rows for no stated reason.
  const searching = searchOpen || terms.length > 0;

  const search = searchPlaceholder ? (
    <div className="flex shrink-0 items-center gap-2 max-sm:w-full">
      {searching ? (
        <div className="reveal-right flex w-full items-center gap-2">
          <input
            ref={searchRef}
            autoFocus
            type="search"
            value={query}
            onChange={(e) => runSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                runSearch("");
                setSearchOpen(false);
                e.currentTarget.blur();
              }
              // ↓ out of the box walks into the list, the way a search field
              // should. The list answers the arrows from the document now, so
              // this only has to put the highlight on the first row.
              if (e.key === "ArrowDown") {
                e.preventDefault();
                e.currentTarget.blur();
                moveTo(0);
              }
            }}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            className="h-11 w-full rounded-md border border-sand bg-transparent px-3 text-base text-ink focus:border-navy-800 sm:h-10 sm:w-72 sm:text-sm"
          />
          <button
            type="button"
            onClick={() => {
              runSearch("");
              setSearchOpen(false);
            }}
            className={iconButtonClass}
            aria-label="Close search"
            title="Close search (Esc)"
          >
            <Icon name="close" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          className={iconButtonClass}
          aria-label={searchPlaceholder}
          title={`${searchPlaceholder} — press /`}
        >
          <Icon name="search" />
        </button>
      )}
      {terms.length > 0 && (
        <span className="shrink-0 text-sm text-steel">
          {visible.length} of {rows.length}
        </span>
      )}
    </div>
  ) : null;

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-300 p-10 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
        {emptyMessage ?? "No records yet."}
      </div>
    );
  }

  const allColumns = [snoColumn, ...columns];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {search}
      {/* tabIndex makes the list itself focusable, which is what gives the arrow
          keys somewhere to arrive. Clicking any row focuses it as a side effect. */}
      {/* Still focusable, so clicking the list is still a way to put the caret
          somewhere sane — but no longer the precondition for the arrow keys,
          which the document listener above handles. */}
      <div
        data-list
        ref={scrollRef}
        tabIndex={0}
        className="scroll-thin mobile-data-list min-h-0 flex-1 overflow-auto rounded-lg border border-zinc-200 outline-none dark:border-zinc-800"
      >
        {visible.length === 0 ? (
          <p className="p-10 text-center text-sm text-steel">
            Nothing matches “{query.trim()}”. Press Esc to clear the search.
          </p>
        ) : (
          <table data-responsive className="w-full border-collapse text-sm md:min-w-max">
            <thead>
              <tr className="sticky top-0 z-10 border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/60">
                {selectable && (
                  <th className="w-10 px-4 py-2.5">
                    <input
                      type="checkbox"
                      aria-label={allSelected ? "Clear selection" : "Select all rows"}
                      checked={allSelected}
                      onChange={() => onSelectedChange!(allSelected ? [] : allIds)}
                      className="h-4 w-4 rounded border-sand align-middle"
                    />
                  </th>
                )}
                {allColumns.map((col) => {
                  const columnSortKey = tableColumnSortKey(col, SNO_KEY);
                  const sortable = columnSortKey !== null;
                  const isActive = sortKey === columnSortKey;
                  return (
                    <th
                      key={col.key}
                      onClick={columnSortKey ? () => toggleSort(columnSortKey) : undefined}
                      className={`whitespace-nowrap px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400 ${
                        col.align === "right" ? "text-right" : "text-left"
                      }${col.hideOnMobile ? " hidden md:table-cell" : ""}${
                        sortable ? " cursor-pointer select-none hover:text-zinc-700 dark:hover:text-zinc-200" : ""
                      }`}
                    >
                      <span className="inline-flex items-center gap-1">
                        {col.label}
                        {isActive && (
                          <Icon
                            name={sortDir === "desc" ? "arrowDown" : "arrowUp"}
                            className="h-3 w-3 shrink-0"
                          />
                        )}
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody ref={bodyRef}>
              {visible.map((row, rowIndex) => {
                const id = String(row[idKey]);
                const href = hrefBase ? `${hrefBase}/${id}` : null;
                // A row flagged _incomplete gets a red dot before its first cell —
                // marks master data created name-only (missing key details). It hangs
                // off the first real column, not the row number.
                const incomplete = row._incomplete === true;
                const body = (col: ColumnDef) => (
                  <>
                    {col.key === columns[0]?.key && incomplete && (
                      <span
                        title="Incomplete — missing details"
                        className="mr-2 inline-block h-2 w-2 shrink-0 rounded-full bg-red-500 align-middle"
                      />
                    )}
                    {col.key === SNO_KEY
                      ? rowIndex + 1
                      : col.render
                        ? col.render(row)
                        : col.badge
                          ? <StatusPill value={row[col.key]} />
                          : String(row[col.key] ?? "—")}
                  </>
                );
                const cellClass = (col: ColumnDef) =>
                  `whitespace-nowrap px-4 py-2.5 text-zinc-700 dark:text-zinc-300 ${
                    col.align === "right" ? "text-right tabular-nums" : "text-left"
                  }${col.hideOnMobile ? " hidden md:table-cell" : ""}`;

                return (
                  // Every row keeps its rule, including the last — the separators used
                  // to be zinc-100 (which the theme remaps to ivory, near-invisible on
                  // white) and the bottom row had none at all, so a long list read as
                  // one block of text. sand is the same hairline the batch grids use.
                  //
                  // Hover is brass-100, the palette's lightest warm tone: enough to
                  // track which row the cursor is on without competing with the red
                  // incomplete dot or the status pills. data-focused paints the same
                  // tone plus a navy edge for the keyboard highlight (globals.css).
                  <tr
                    key={id}
                    data-focused={rowIndex === focused}
                    // Absent rather than "false" when the row is settled: the
                    // style keys off the attribute being there at all.
                    data-pending={pendingIds?.includes(id) ? "" : undefined}
                    onMouseDown={() => onRowMouseDown(rowIndex)}
                    onPointerEnter={() => onRowIntent?.(row)}
                    onTouchStart={() => onRowIntent?.(row)}
                    className={`border-b border-sand hover:bg-brass-100 dark:border-zinc-800/60 dark:hover:bg-zinc-900/40 ${
                      selectedSet.has(id) ? "bg-navy-100" : ""
                    }`}
                  >
                    {selectable && (
                      <td data-label="Select" className="px-4 py-2.5">
                        <input
                          type="checkbox"
                          aria-label={`Select ${String(row[columns[0]?.key ?? idKey] ?? "row")}`}
                          checked={selectedSet.has(id)}
                          onChange={() => toggle(id)}
                          className="h-4 w-4 rounded border-sand align-middle"
                        />
                      </td>
                    )}
                    {href
                      ? allColumns.map((col) => (
                          <td key={col.key} data-label={col.label} className={`p-0${col.hideOnMobile ? " hidden md:table-cell" : ""}`}>
                            <Link href={href} className={`block ${cellClass(col)}`}>
                              {body(col)}
                            </Link>
                          </td>
                        ))
                      : onRowClick
                        ? allColumns.map((col) => (
                            <td
                              key={col.key}
                              data-label={col.label}
                              className={`${col.label ? "cursor-pointer " : ""}p-0${col.hideOnMobile ? " hidden md:table-cell" : ""}`}
                              onMouseDown={col.label ? undefined : (event) => event.stopPropagation()}
                              onClick={col.label ? () => onRowClick(row) : (event) => event.stopPropagation()}
                            >
                              <span className={`block ${cellClass(col)}`}>{body(col)}</span>
                            </td>
                          ))
                        : allColumns.map((col) => (
                            <td key={col.key} data-label={col.label} className={cellClass(col)}>
                              {body(col)}
                            </td>
                          ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

    </div>
  );
}
