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

// A column that mixes dates with words (a report's "Last Sold" can be the word
// "Never") gets this: format only what is actually a date, pass everything else
// through untouched.
export function formatDateWhenDate(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? formatDate(value) : value;
}

// "2026-08" — a report's Month column — reads as "08-2026", the same day-first
// ordering as formatDate.
export function formatMonth(value: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(value);
  return m ? `${m[2]}-${m[1]}` : value;
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

const moneyFormat = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyFormat = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Round to whole number (no decimals), then display with .00.
export function money(value: string | number): string {
  const n = Number(value);
  return Number.isFinite(n) ? moneyFormat.format(Math.round(n)) : String(value);
}

// Two decimal places.
export function qty(value: string | number): string {
  const n = Number(value);
  return Number.isFinite(n) ? qtyFormat.format(n) : String(value);
}

// --- Landed cost -------------------------------------------------------------
// Shipping, discount and tax are charged on a delivery, never on one line of it,
// so a unit's share is the whole adjustment spread over every unit that arrived
// in the same load: shipping - discount + tax, the same signs the grand total
// uses. Kept unrounded on purpose — rounding here and then multiplying by the
// quantity is what makes a column of unit costs stop adding up to the invoice.
//
// No units, nothing to share — dividing by nothing would hand back Infinity and
// paint it down the grid.
export function perUnitShare(amount: number, totalQuantity: number): number {
  return totalQuantity > 0 ? amount / totalQuantity : 0;
}

// The landed cost itself, rounded up to the rupee. Up, not to the nearest: this
// is the floor under a selling price, and the half of a rupee that rounding down
// would shave off is sold at a loss every time the item goes out.
//
// It follows that the column no longer adds back to the invoice — the landed
// costs sum to a little *over* the grand total, by under one rupee per line.
// That is the price of a whole-rupee cost, and it is the reason the payable is
// settled against unit_price, which is untouched by any of this.
export function landedUnitCost(unitPrice: number, share: number): number {
  return Math.ceil(unitPrice + share);
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
