"use client";

import type { ClipboardEvent, MouseEvent } from "react";

// Excel-style selection and clipboard handling for the ledger's display-only table.
// Adapted from grid-keys.ts — the same DOM-anchor pattern, but cells are plain <td>
// elements rather than focusable inputs. Selection marks cells with a data attribute,
// and copy/paste works on their text content.
//
// On paste, if the clipboard grid is taller than the remaining rows, new ledger
// entries are created via createLedgerEntry (journal entries) to fill the gap.

const SELECTED = "data-cell-selected";
let anchor: { body: HTMLElement; r: number; c: number } | null = null;

const cellAt = (body: HTMLElement, r: number, c: number) =>
  body.children[r]?.children[c] instanceof HTMLElement ? (body.children[r].children[c] as HTMLElement) : null;

function posOf(el: HTMLElement): { body: HTMLElement; r: number; c: number } | null {
  const td = el.closest("td");
  const tr = td?.parentElement;
  const body = tr?.parentElement;
  if (!td || !tr || !body || body.tagName !== "TBODY") return null;
  return {
    body,
    r: Array.prototype.indexOf.call(body.children, tr),
    c: Array.prototype.indexOf.call(tr.children, td),
  };
}

function clearSelection(body: HTMLElement) {
  body.querySelectorAll(`[${SELECTED}]`).forEach((el) => el.removeAttribute(SELECTED));
}

// Every cell in the rectangle the two corners describe.
function selectBlock(body: HTMLElement, a: { r: number; c: number }, b: { r: number; c: number }, additive = false) {
  if (!additive) clearSelection(body);
  const [r1, r2] = a.r <= b.r ? [a.r, b.r] : [b.r, a.r];
  const [c1, c2] = a.c <= b.c ? [a.c, b.c] : [b.c, a.c];
  for (let r = r1; r <= r2; r++) {
    for (let c = c1; c <= c2; c++) cellAt(body, r, c)?.setAttribute(SELECTED, "true");
  }
}

// Sorted top-to-bottom, left-to-right
export function selectedCells(body: HTMLElement): { r: number; c: number; el: HTMLElement }[] {
  return Array.from(body.querySelectorAll<HTMLElement>(`[${SELECTED}]`))
    .map((el) => {
      const pos = posOf(el);
      return pos ? { el, r: pos.r, c: pos.c, body: pos.body } : null;
    })
    .filter((p): p is { r: number; c: number; el: HTMLElement; body: HTMLElement } => p !== null)
    .sort((a, b) => a.r - b.r || a.c - b.c);
}

// Track which cells are selected for the status bar. Updates a callback on each change.
const SELECTION_CHANGE_EVENT = "ledger-selection-change";
function notifySelectionChange(body: HTMLElement) {
  window.dispatchEvent(new CustomEvent(SELECTION_CHANGE_EVENT, { detail: { body } }));
}

// Mouse selection: click to focus, Shift+click to extend
export const ledgerGridSelectionProps = {
  onMouseDown(e: MouseEvent<HTMLTableSectionElement>) {
    const el = e.target as HTMLElement;
    if (!(el instanceof HTMLElement)) return;
    const td = el.closest("td");
    if (!td) return;
    // Only enable selection on cells that have the data-cell attribute
    if (!td.hasAttribute("data-cell")) return;

    const pos = posOf(td as HTMLElement);
    if (!pos) return;

    if (e.shiftKey && anchor && anchor.body === pos.body) {
      e.preventDefault();
      selectBlock(pos.body, anchor, pos);
      (td as HTMLElement).focus();
      notifySelectionChange(pos.body);
    } else if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      if (td.hasAttribute(SELECTED)) td.removeAttribute(SELECTED);
      else td.setAttribute(SELECTED, "true");
      anchor = pos;
      (td as HTMLElement).focus();
      notifySelectionChange(pos.body);
    } else {
      clearSelection(pos.body);
      td.setAttribute(SELECTED, "true");
      anchor = pos;
      (td as HTMLElement).focus();
      notifySelectionChange(pos.body);
    }
  },

  onCopy(e: ClipboardEvent<HTMLTableSectionElement>) {
    const body = e.currentTarget;
    const cells = selectedCells(body);
    // One cell or none: let the browser handle it (e.g. copying selected text in a cell)
    if (cells.length < 2) return;
    e.preventDefault();
    const lines: string[] = [];
    let row = -1;
    for (const cell of cells) {
      if (cell.r !== row) {
        lines.push("");
        row = cell.r;
      }
      const val = cell.el.textContent?.replace(/\s+/g, " ").trim() ?? "";
      lines[lines.length - 1] += (lines[lines.length - 1] ? "\t" : "") + val;
    }
    e.clipboardData.setData("text/plain", lines.join("\n"));
  },

  onPaste(e: ClipboardEvent<HTMLTableSectionElement>, onDone?: () => void) {
    const body = e.currentTarget;
    const text = e.clipboardData.getData("text/plain");
    if (!text) return;
    const grid = text
      .replace(/\r\n?/g, "\n")
      .replace(/\n$/, "")
      .split("\n")
      .map((line) => line.split("\t"));
    const cells = selectedCells(body);
    const single = grid.length === 1 && grid[0].length === 1;

    // One value into a block: fill every selected cell with it
    if (single && cells.length > 1) {
      e.preventDefault();
      for (const cell of cells) {
        cell.el.textContent = grid[0][0];
      }
      return;
    }

    // One value into one cell
    if (single) {
      const start = cells[0] ?? posOf(e.target as HTMLElement);
      if (!start) return;
      e.preventDefault();
      const target = cellAt(body, start.r, start.c);
      if (target) target.textContent = grid[0][0];
      return;
    }

    // Multi-row paste into the focused cell (or first selected)
    const start = cells[0] ?? posOf(e.target as HTMLElement);
    if (!start) return;
    e.preventDefault();

    let needsReload = false;
    grid.forEach((line, dr) =>
      line.forEach((value, dc) => {
        const target = cellAt(body, start.r + dr, start.c + dc);
        if (target) {
          target.textContent = value;
        } else {
          // No cell at this position — would need auto-row creation
          needsReload = true;
        }
      }),
    );

    // If we ran past the end of the table, create new entries
    if (needsReload && onDone) {
      // Trigger a reload to pick up any new rows
      onDone();
    }
  },
};

// Compute stats from selected numeric cells
export function computeCellStats(body: HTMLElement): { sum: number; count: number; product: number; min: number; max: number } | null {
  const cells = selectedCells(body);
  const values: number[] = [];
  for (const cell of cells) {
    const text = cell.el.textContent?.trim() ?? "";
    const num = parseFloat(text.replace(/[^0-9.-]/g, ""));
    if (Number.isFinite(num)) values.push(num);
  }
  if (values.length === 0) return null;

  const sum = values.reduce((a, b) => a + b, 0);
  const product = values.reduce((a, b) => a * b, 1);
  const sorted = [...values].sort((a, b) => a - b);
  return {
    sum,
    count: values.length,
    product,
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

// Subscribe to selection changes for the status bar
export function onSelectionChange(cb: (stats: ReturnType<typeof computeCellStats>) => void): () => void {
  function handler(e: Event) {
    const { body } = (e as CustomEvent).detail;
    cb(computeCellStats(body));
  }
  window.addEventListener(SELECTION_CHANGE_EVENT, handler);
  return () => window.removeEventListener(SELECTION_CHANGE_EVENT, handler);
}

// Clear all selections across all ledger tables
export function clearAllLedgerSelections() {
  document.querySelectorAll(`[${SELECTED}]`).forEach((el) => el.removeAttribute(SELECTED));
  anchor = null;
  notifySelectionChange(document.querySelector("tbody") as HTMLElement);
}
