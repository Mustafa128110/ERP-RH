import type { ClipboardEvent, KeyboardEvent, MouseEvent, RefObject } from "react";

// Excel-style keyboard handling for the editable grids — the batch-add popups,
// the product edit grid, and anything else laid out as one record per row.
// Attached to the <tbody> so one listener serves every cell.
//
//   ↑ ↓ (and Enter)    same column, neighbouring row
//   ← →                across columns, from the edge of the text
//   Shift + arrows     grow a block of cells from where the selection started
//   Ctrl / Shift + click   the same two rules with the mouse
//   Ctrl + C / Ctrl + V    copy/paste a cell, or a whole block — the cell goes
//                          even when nothing is selected, like Excel
//   Ctrl + Enter       save
//   Delete             empty the cell (Ctrl+Backspace does the same)
//
// Selects keep their native Up/Down (which changes the option), so only Enter
// jumps rows from a select.

// React tracks an input's value on the DOM node and skips onChange when the new
// value matches what it last saw, so assigning `el.value` directly clears the
// box on screen and leaves the row state holding the old text. Going through the
// prototype's setter updates the node past that tracker, and the dispatched
// event is what React's delegated listener turns back into onChange.
//
// Design note: this is the standard way to drive a controlled input from outside
// React. The alternative — a data-field attribute on all ~12 cells plus a
// per-field clear callback in every grid — is more code in more places and has
// to know each cell's shape (a typeahead clears to {id,text}, not "").
function setCellValue(el: HTMLElement, value: string) {
  if (el instanceof HTMLSelectElement) {
    // A select can only hold one of its options. Matched on the visible label
    // too, so a value copied out of a text cell ("Kilogram") still lands.
    const match = Array.from(el.options).find((o) => o.value === value || o.text === value);
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(el, match ? match.value : "");
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }
  if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
    const next = value === "true" || value === "1" || value.toLowerCase() === "yes";
    if (el.checked !== next) el.click();
    return;
  }
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function cellValue(el: HTMLElement): string {
  if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) return String(el.checked);
  if (el instanceof HTMLSelectElement) return el.options[el.selectedIndex]?.text ?? el.value;
  return (el as HTMLInputElement).value ?? "";
}

// Copies a cell's value without touching the caret. Text inputs (and
// textareas) can select in place and take the synchronous execCommand path;
// number/date inputs can't hold a selection — select() would throw on them —
// so they go through the async clipboard API instead.
function copyCellValue(el: HTMLInputElement | HTMLTextAreaElement) {
  if (el instanceof HTMLInputElement && el.selectionStart === null) {
    // type=number / type=date: no selection exists to copy.
    if (navigator.clipboard?.writeText) void navigator.clipboard.writeText(el.value);
    return;
  }
  const { selectionStart, selectionEnd } = el;
  el.select();
  document.execCommand("copy");
  el.setSelectionRange(selectionStart ?? 0, selectionEnd ?? 0);
}

// --- Cell selection ---------------------------------------------------------
// The selected cells are marked with an attribute on the DOM node rather than
// held in React state: the mark then costs no re-render, survives the parent's
// own renders (React only patches the props it set), and globals.css can paint
// it. One grid has focus at a time, so a single module-level anchor is enough.

const SELECTED = "data-cell-selected";
let anchor: { body: HTMLElement; r: number; c: number } | null = null;

const focusableIn = (td: Element | undefined) => td?.querySelector<HTMLElement>("input, select, textarea") ?? null;

const cellAt = (body: HTMLElement, r: number, c: number) => focusableIn(body.children[r]?.children[c]);

function posOf(el: HTMLElement): { body: HTMLElement; r: number; c: number } | null {
  const td = el.closest("td");
  const tr = td?.parentElement;
  const body = tr?.parentElement;
  if (!td || !tr || !body || body.tagName !== "TBODY") return null;
  return { body, r: Array.prototype.indexOf.call(body.children, tr), c: Array.prototype.indexOf.call(tr.children, td) };
}

function clearSelection(body: HTMLElement) {
  body.querySelectorAll(`[${SELECTED}]`).forEach((el) => el.removeAttribute(SELECTED));
}

// Every cell in the rectangle the two corners describe. Cells with nothing
// focusable in them (the ✕ column) are simply skipped.
function selectBlock(body: HTMLElement, a: { r: number; c: number }, b: { r: number; c: number }, additive = false) {
  if (!additive) clearSelection(body);
  const [r1, r2] = a.r <= b.r ? [a.r, b.r] : [b.r, a.r];
  const [c1, c2] = a.c <= b.c ? [a.c, b.c] : [b.c, a.c];
  for (let r = r1; r <= r2; r++) {
    for (let c = c1; c <= c2; c++) cellAt(body, r, c)?.setAttribute(SELECTED, "true");
  }
}

// Sorted top-to-bottom, left-to-right — the order a copy has to come out in.
function selectedCells(body: HTMLElement): { r: number; c: number; el: HTMLElement }[] {
  return Array.from(body.querySelectorAll<HTMLElement>(`[${SELECTED}]`))
    .map((el) => ({ el, ...posOf(el)! }))
    .filter((p) => p.body)
    .sort((a, b) => a.r - b.r || a.c - b.c);
}

// Spread onto the same <tbody> as gridKeyDown: mouse selection and the two
// clipboard verbs. Keyboard selection lives in gridKeyDown, which the grids
// already wire up.
//
// A plain object, not a factory taking the body ref: each handler gets the
// <tbody> from its own event, so there is nothing to pass in and nothing read
// during render.
export const gridSelectionProps = {
  onMouseDown(e: MouseEvent<HTMLTableSectionElement>) {
    const el = e.target as HTMLElement;
    if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement)) return;
    const pos = posOf(el);
    if (!pos) return;

    if (e.shiftKey && anchor && anchor.body === pos.body) {
      e.preventDefault();
      selectBlock(pos.body, anchor, pos);
      el.focus();
    } else if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      if (el.hasAttribute(SELECTED)) el.removeAttribute(SELECTED);
      else el.setAttribute(SELECTED, "true");
      anchor = pos;
      el.focus();
    } else {
      clearSelection(pos.body);
      anchor = pos;
    }
  },

  onCopy(e: ClipboardEvent<HTMLTableSectionElement>) {
    const body = e.currentTarget;
    const cells = selectedCells(body);
    // One cell (or none) means an ordinary copy — the browser's own, so
    // copying part of a field's text still works.
    if (cells.length < 2) return;
    e.preventDefault();
    const lines: string[] = [];
    let row = -1;
    for (const cell of cells) {
      if (cell.r !== row) {
        lines.push("");
        row = cell.r;
      }
      lines[lines.length - 1] += (lines[lines.length - 1] ? "\t" : "") + cellValue(cell.el);
    }
    e.clipboardData.setData("text/plain", lines.join("\n"));
  },

  onPaste(e: ClipboardEvent<HTMLTableSectionElement>) {
    const body = e.currentTarget;
    const text = e.clipboardData.getData("text/plain");
    if (!text) return;
    const grid = text.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n").map((line) => line.split("\t"));
    const cells = selectedCells(body);
    const single = grid.length === 1 && grid[0].length === 1;

    // One value into a block: fill every selected cell with it. That's the
    // "type it once, apply it to twelve rows" case this exists for.
    if (single && cells.length > 1) {
      e.preventDefault();
      for (const cell of cells) setCellValue(cell.el, grid[0][0]);
      return;
    }
    // One value into one cell replaces the whole cell — the Excel rule, so a
    // paste lands in the cell, not at the caret, and nothing has to be
    // selected first. Read off the focused cell (or the single selected one),
    // whichever the paste gesture started in.
    if (single) {
      const start = cells[0] ?? posOf(e.target as HTMLElement);
      if (!start) return;
      e.preventDefault();
      const target = cellAt(body, start.r, start.c);
      if (target) setCellValue(target, grid[0][0]);
      return;
    }

    const start = cells[0] ?? posOf(e.target as HTMLElement);
    if (!start) return;
    e.preventDefault();
    grid.forEach((line, dr) =>
      line.forEach((value, dc) => {
        const target = cellAt(body, start.r + dr, start.c + dc);
        if (target) setCellValue(target, value);
      }),
    );
  },
};

export function gridKeyDown(
  e: KeyboardEvent<HTMLTableSectionElement>,
  bodyRef: RefObject<HTMLTableSectionElement | null>,
  onSubmit?: () => void,
) {
  // A typeahead cell handles its own arrows while its list is open and marks the
  // event handled; without this the grid would move focus out from under it.
  if (e.defaultPrevented) return;

  const el = e.target as HTMLElement;

  // Ctrl+Enter saves. Only handled here when the caller asked for it — a grid
  // inside a real <form> leaves it to the app-wide handler in KeyboardShortcuts,
  // and doing both would submit twice. The event is stopped once the grid takes
  // the save so the app-wide handler can't also click the dialog's
  // data-dialog-submit button and save a second time.
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    if (!onSubmit) return;
    e.preventDefault();
    e.stopPropagation();
    onSubmit();
    return;
  }

  // Ctrl+C copies like Excel: the whole cell, with nothing selected. With text
  // selected inside the cell, that selection is what the browser's own copy
  // takes — the copy/paste events gridSelectionProps handles then turn a
  // selected block into one clipboard payload either way. Checkboxes are left
  // alone, same as Delete above: Space toggles them, and "copy its value"
  // isn't a question anyone is asking.
  if ((e.ctrlKey || e.metaKey) && e.key === "c") {
    if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) return;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      // selectionStart is null on number/date inputs, so null === null reads
      // as "nothing selected" and copies the whole cell there too.
      if (el.selectionStart === el.selectionEnd) {
        e.preventDefault();
        copyCellValue(el);
      }
    }
    return;
  }

  // Ctrl+V / Ctrl+X stay the browser's: V becomes the paste event below (which
  // owns the single-cell and block fills), X is a plain cut.
  if ((e.ctrlKey || e.metaKey) && (e.key === "v" || e.key === "x")) return;

  // Clearing a cell. Checkboxes are left alone — Space already toggles them, and
  // "empty" isn't a state they have. A block clears together.
  if (e.key === "Delete" || (e.key === "Backspace" && (e.ctrlKey || e.metaKey))) {
    if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement)) return;
    if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) return;
    e.preventDefault();
    const block = bodyRef.current ? selectedCells(bodyRef.current) : [];
    if (block.length > 1) block.forEach((cell) => setCellValue(cell.el, ""));
    else setCellValue(el, "");
    return;
  }

  // Ctrl/Alt + ArrowDown opens the dropdown of a focused native select. Ctrl is
  // also the selection modifier below, so this only claims it for a select.
  if (e.altKey && e.key === "ArrowDown" && el instanceof HTMLSelectElement) {
    e.preventDefault();
    try {
      el.showPicker();
    } catch {
      // Older browsers: no showPicker — the select still opens on click/Space.
    }
    return;
  }

  const horizontal = e.key === "ArrowLeft" || e.key === "ArrowRight";
  if (!horizontal && e.key !== "ArrowUp" && e.key !== "ArrowDown" && e.key !== "Enter") return;
  if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement)) return;
  if (el.tagName === "SELECT" && !horizontal && e.key !== "Enter") return;
  const pos = posOf(el);
  if (!pos || !bodyRef.current) return;
  const { body, r, c } = pos;
  const extending = e.shiftKey;
  const dir = e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 1;

  // Inside text the arrow belongs to the caret — only jump cells from the edge.
  // Extending a selection is the exception: there the arrow is about cells, not
  // about the caret. selectionStart is null on number/date inputs, which have no
  // caret to preserve, so those always jump.
  if (horizontal && !extending && !(el instanceof HTMLSelectElement) && el.selectionStart !== null) {
    const atEdge = e.key === "ArrowLeft" ? el.selectionStart === 0 : el.selectionEnd === el.value.length;
    if (!atEdge) return;
  }

  // Walk past cells with nothing focusable in them (the ✕ column).
  let target: HTMLElement | null = null;
  let to = { r, c };
  if (horizontal) {
    const tr = body.children[r];
    for (let i = c + dir; i >= 0 && i < tr.children.length; i += dir) {
      const found = focusableIn(tr.children[i]);
      if (found) {
        target = found;
        to = { r, c: i };
        break;
      }
    }
  } else {
    target = cellAt(body, r + dir, c);
    to = { r: r + dir, c };
  }
  if (!target) return;

  e.preventDefault();
  target.focus();

  if (e.shiftKey) {
    if (!anchor || anchor.body !== body) anchor = { body, r, c };
    selectBlock(body, anchor, to);
  } else {
    clearSelection(body);
    anchor = { body, ...to };
  }
}
