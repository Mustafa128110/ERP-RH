// Turning "cment 50" into the right product.
//
// Nobody typing on a phone spells the catalogue correctly, and the catalogue
// itself is full of names like "Cement OPC 50kg Bag - Lucky". Matching has to be
// forgiving about order and about extra words, and strict about one thing only:
// never silently pick when the query genuinely matches several. The caller shows
// the shortlist and asks.
//
// Pure — no database, no session — which is what lets
// lib/whatsapp-agent/match.check.ts hold it to that.

// Ranked worst-to-best so a higher number always wins. Exact beats prefix beats
// "every word you typed is in there somewhere".
const EXACT = 3;
const PREFIX = 2;
const TOKENS = 1;

function normalize(text: string): string {
  return text
    .toLowerCase()
    // Punctuation between words is noise: "50kg-bag" and "50kg bag" are the
    // same request. Collapsed to single spaces so token splitting is trivial.
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function score(query: string, name: string): number {
  const q = normalize(query);
  const n = normalize(name);
  if (!q) return 0;
  if (q === n) return EXACT;
  if (n.startsWith(q)) return PREFIX;
  const words = n.split(" ");
  // Every token must appear as a prefix of some word — "cem 50" matches
  // "cement 50kg bag", "50 cem" matches it too, and "cement steel" does not.
  const all = q.split(" ").every((t) => words.some((w) => w.startsWith(t)));
  return all ? TOKENS : 0;
}

export interface Match<T> {
  row: T;
  score: number;
}

// Best matches first, capped. An empty result means nothing matched at all —
// distinct from several matching, which the caller must disambiguate rather
// than guess at.
export function bestMatches<T>(query: string, rows: readonly T[], nameOf: (row: T) => string, limit = 5): T[] {
  const scored: Match<T>[] = [];
  for (const row of rows) {
    const s = score(query, nameOf(row));
    if (s > 0) scored.push({ row, score: s });
  }
  // Stable within a score band: rows arrive alphabetically from the queries, so
  // equally-good matches list alphabetically too.
  scored.sort((a, b) => b.score - a.score);

  // One exact match ends the question — a product literally called "Cement"
  // should not be offered alongside "Cement Paint" for the query "cement".
  if (scored[0]?.score === EXACT) {
    const exact = scored.filter((m) => m.score === EXACT);
    if (exact.length === 1) return [exact[0].row];
  }
  return scored.slice(0, limit).map((m) => m.row);
}

// The reply when a query matched several things. Numbered because the natural
// next message is "2" — which the caller can feed back in as the choice.
export function chooseFrom(label: string, names: string[]): string {
  return [`Which ${label}?`, ...names.map((n, i) => `${i + 1}. ${n}`), "", "Reply with the number or a fuller name."].join("\n");
}

// A bare number, when the last reply was a shortlist. Returns a zero-based index
// or null. Bounded by `count` so "7" against a list of three is not a choice —
// it falls through to being treated as ordinary text.
export function chosenIndex(text: string, count: number): number | null {
  const m = /^\s*(\d{1,2})\s*$/.exec(text);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= count ? n - 1 : null;
}
