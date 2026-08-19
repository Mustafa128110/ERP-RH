// CSV in and out. Shared by the client (template download, export file, reading
// a picked file) and the server actions that take the parsed rows, so this file
// stays free of both "use server" and browser APIs.
//
// Design note: hand-rolled rather than papaparse — the format is a comma, a quote
// and a newline. Swap in a library if quoted-multiline files from Excel ever
// prove it wrong.

export type CsvColumn = {
  key: string;
  label: string;
  // Shown with a "*" on the heading, and refused on import when the column is
  // absent or a cell in it is blank.
  required?: boolean;
  // The one example row the template carries, so the file opens with a filled-in
  // line to copy rather than a bare header.
  sample?: string;
  // Derived values (rates read off past documents). Exported so the file is a
  // full picture, left out of the template, ignored on import.
  readOnly?: boolean;
};

// The "*" is part of the heading text a user sees, so header matching strips it
// back off — a file saved from the template round-trips without editing.
export const csvHeader = (c: CsvColumn) => (c.required ? `${c.label} *` : c.label);

const headerKey = (s: string) => s.replace(/\*/g, "").trim().toLowerCase();

// Excel and Sheets execute a cell that opens with =, +, @ or a lone -, so an
// item named "=cmd" would run on whoever opens the export. The apostrophe is
// what those two read as "this is text".
const RISKY = /^[=+@\t\r]|^-(?![\d.])/;

function cell(value: string): string {
  const v = RISKY.test(value) ? `'${value}` : value;
  return /[",\r\n]|^\s|\s$/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function toCsv(rows: string[][]): string {
  return rows.map((r) => r.map(cell).join(",")).join("\r\n");
}

// Returns the raw grid. Handles quoted fields (embedded commas, quotes and
// newlines), CRLF or LF, and the BOM Excel writes. Fully blank lines are
// dropped — a spreadsheet saved with trailing empty rows is the normal case,
// not an error.
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      // A doubled quote inside a quoted field is one literal quote.
      if (ch !== '"') value += ch;
      else if (src[i + 1] === '"') {
        value += '"';
        i++;
      } else quoted = false;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(value);
      value = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else value += ch;
  }
  if (value !== "" || row.length > 0) {
    row.push(value);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

// Grid -> one object per data row, keyed by CsvColumn.key. Columns the file
// doesn't have come back as ""; columns the file has that we don't know about
// are ignored, so a user's own notes column doesn't break the import.
export function csvToObjects(
  text: string,
  columns: CsvColumn[],
): { rows: Record<string, string>[]; error?: string } {
  const grid = parseCsv(text);
  if (grid.length === 0) return { rows: [], error: "That file is empty." };

  const byHeader = new Map(columns.map((c) => [headerKey(c.label), c.key]));
  const keys = grid[0].map((h) => byHeader.get(headerKey(h)) ?? null);

  const missing = columns.filter((c) => c.required && !keys.includes(c.key)).map(csvHeader);
  if (missing.length > 0) {
    return { rows: [], error: `Missing column(s): ${missing.join(", ")}. Download the template for the exact headings.` };
  }

  const rows = grid.slice(1).map((r) => {
    const o: Record<string, string> = {};
    for (const c of columns) o[c.key] = "";
    keys.forEach((k, i) => {
      if (k) o[k] = (r[i] ?? "").trim();
    });
    return o;
  });
  return { rows };
}

export function objectsToCsv(columns: CsvColumn[], rows: Record<string, string>[]): string {
  return toCsv([columns.map(csvHeader), ...rows.map((r) => columns.map((c) => r[c.key] ?? ""))]);
}

// Headings plus one example row. Read-only columns are left out: a template is
// for typing into, and nothing typed into a derived column would be saved.
export function templateCsv(columns: CsvColumn[]): string {
  const cols = columns.filter((c) => !c.readOnly);
  return toCsv([cols.map(csvHeader), cols.map((c) => c.sample ?? "")]);
}

// A file with 400 bad rows reports the first ten and a count. The whole list in
// one dialog is unreadable, and the fix for the eleventh is usually the fix for
// the first.
export function csvErrorText(errors: string[]): string {
  const shown = errors.slice(0, 10).join("\n");
  return errors.length > 10 ? `${shown}\n…and ${errors.length - 10} more problem(s).` : shown;
}

// "yes" / "true" / "1" / "y" — anything else is false. Blank falls back to the
// column's own default, which is why the caller passes one.
export function csvBool(value: string, fallback: boolean): boolean {
  const v = value.trim().toLowerCase();
  if (v === "") return fallback;
  return v === "yes" || v === "true" || v === "1" || v === "y";
}
