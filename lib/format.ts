// slug = lowercase name, spaces to hyphens, any other special char dropped.
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

// --- Dates -------------------------------------------------------------------
// The database speaks ISO (YYYY-MM-DD, what a Postgres `date` column holds and
// what <input type="date"> submits). Everything a human reads or types is
// DD-MM-YYYY. These two are the only conversion between the pair.

export function formatDate(value: string | Date): string {
  const [year, month, day] =
    value instanceof Date
      ? [value.getFullYear(), value.getMonth() + 1, value.getDate()]
      : value.split("-").map(Number);
  return `${String(day).padStart(2, "0")}-${String(month).padStart(2, "0")}-${year}`;
}

// "25-12-2026" -> "2026-12-25". Returns "" for anything that isn't a complete
// date, which is what a half-typed field holds.
//
// Slashes and dots are read as separators too — a spreadsheet writes 25/12/2026
// on its own, and someone typing a date types whichever key their old system
// used. Only the reading is loose: what gets written back out is always
// DD-MM-YYYY (formatDate above), and what's stored is always ISO.
export function toISODate(display: string): string {
  const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(display.trim());
  if (!m) return "";
  const [, d, mo, y] = m;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

// Today in local time. toISOString() is UTC and hands back yesterday for an
// evening entry at UTC+5.
export const todayISO = () => new Date().toLocaleDateString("en-CA");

// --- Money and quantity ------------------------------------------------------
// Money carries one decimal place and South-Asian digit grouping (##,##,###).
// Quantity carries two and groups in thousands — it's a count, not a price.

// Rounded before it is stored, not only before it is shown, so what the ledger
// holds and what the screen says are the same number.
export const round1 = (n: number) => Math.round(n * 10) / 10;

const moneyFormat = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const qtyFormat = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function money(value: string | number): string {
  const n = Number(value);
  return Number.isFinite(n) ? moneyFormat.format(n) : String(value);
}

export function qty(value: string | number): string {
  const n = Number(value);
  return Number.isFinite(n) ? qtyFormat.format(n) : String(value);
}

// --- Discount / tax entry ----------------------------------------------------
// One field, not a number plus a Rs/% dropdown: "500" is five hundred rupees,
// "5%" is five percent of the subtotal. Returns the resolved amount.
export function resolveAdjustment(raw: string, base: number): number {
  const text = raw.trim();
  if (text === "") return 0;
  if (text.endsWith("%")) {
    const percent = Number(text.slice(0, -1).trim());
    return Number.isFinite(percent) ? round1((base * percent) / 100) : 0;
  }
  const amount = Number(text);
  return Number.isFinite(amount) ? round1(amount) : 0;
}
