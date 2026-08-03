// What the shop actually types, recognised without an LLM.
//
// The great majority of messages to this bot are four or five shapes — "rate
// cement", "stock", "balance ahmed", "due", "yes". Sending those to Gemini would
// add a second of latency, spend a request from a daily quota, and introduce a
// chance of the model deciding to do something else entirely. So they are parsed
// here, deterministically, and the model only ever sees what this does not
// recognise.
//
// Pure: no database, no network, no session. That is what makes
// lib/whatsapp-agent/commands.check.ts able to pin every one of these down.

export type Command =
  | { kind: "help" }
  | { kind: "confirm" }
  | { kind: "cancel" }
  | { kind: "rate"; query: string }
  | { kind: "stock"; query: string }
  | { kind: "balance"; query: string }
  | { kind: "due" }
  | { kind: "sales"; when: "today" | "yesterday" | "month" | { date: string } }
  | { kind: "invoice"; number: string }
  // Not recognised — hand it to the agent.
  | { kind: "agent"; text: string };

// "yes", "y", "ok", "haan", "han", "confirm", "done", "ji" — the words people
// actually reply with, including the Urdu ones a Karachi shop will use.
const YES = /^(y|yes|yep|ok|okay|confirm|confirmed|done|go|send|haan|han|ji|jee|theek|thik)\b/i;
const NO = /^(n|no|nope|cancel|stop|nahi|nai|nahin|rehne|chor)\b/i;

// Leading verbs that mean "look this up" and carry no meaning of their own, so
// "what is the rate of cement" and "rate cement" reach the same place.
const FILLER =
  /^(?:please\s+|pls\s+|plz\s+|kindly\s+|can\s+you\s+|could\s+you\s+|what(?:'s| is| are)?\s+|whats\s+|show\s+(?:me\s+)?|tell\s+(?:me\s+)?|give\s+(?:me\s+)?|get\s+|check\s+|find\s+|batao\s+|bata\s+|the\s+|my\s+)+/i;

// Trailing scaffolding around the subject: "rate of cement" -> "cement",
// "stock for pipes please" -> "pipes".
function subject(rest: string): string {
  return rest
    .trim()
    // Trailing `(?:\s+|$)` so a dangling "rate of" reduces to nothing and asks
    // for a subject, rather than searching for a product called "of".
    .replace(/^(?:of|for|on|about|ka|ki|ke)(?:\s+|$)/i, "")
    .replace(/\s+(?:please|pls|plz|kya|hai|hy|h)\s*$/i, "")
    .replace(/[?.!]+$/, "")
    .trim();
}

// DD-MM-YYYY, the format everything else in this app reads and writes
// (lib/format.ts). Returns null for anything that isn't a complete date, so a
// half-typed one falls through to the agent rather than querying a wrong day.
function asDate(text: string): string | null {
  const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(text.trim());
  if (!m) return null;
  const [, d, mo, y] = m;
  const day = Number(d);
  const month = Number(mo);
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  return `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseCommand(raw: string): Command {
  const text = raw.trim();
  if (!text) return { kind: "help" };

  // Confirmations are checked before anything else and on the raw text: a bare
  // "yes" must never be interpreted as a search for a product called "yes".
  if (YES.test(text)) return { kind: "confirm" };
  if (NO.test(text)) return { kind: "cancel" };

  const cleaned = text.replace(FILLER, "").trim();
  const lower = cleaned.toLowerCase();

  if (/^(help|menu|commands|\?)$/.test(lower)) return { kind: "help" };

  // Anything owed to us, oldest first.
  if (/^(due|dues|outstanding|receivable|receivables|udhaar|udhar)\b/.test(lower)) return { kind: "due" };

  const rate = /^(?:rate|rates|price|prices|bhao|bhaao)\b(.*)$/i.exec(cleaned);
  if (rate) {
    const query = subject(rate[1]);
    // "rate" with nothing after it is a question the bot can't answer — of what?
    return query ? { kind: "rate", query } : { kind: "help" };
  }

  const stock = /^(?:stock|inventory|qty|quantity|available|maal)\b(.*)$/i.exec(cleaned);
  if (stock) {
    const query = subject(stock[1]);
    return query ? { kind: "stock", query } : { kind: "help" };
  }

  const balance = /^(?:balance|bal|owes?|khata|hisaab|hisab|ledger)\b(.*)$/i.exec(cleaned);
  if (balance) {
    const query = subject(balance[1]);
    return query ? { kind: "balance", query } : { kind: "help" };
  }

  const sales = /^(?:sales|sale|sold|takings|bikri)\b(.*)$/i.exec(cleaned);
  if (sales) {
    const when = subject(sales[1]).toLowerCase();
    // A bare "sales" means today — the question nobody has to qualify.
    if (!when || /^(today|aaj|aj)$/.test(when)) return { kind: "sales", when: "today" };
    if (/^(yesterday|kal)$/.test(when)) return { kind: "sales", when: "yesterday" };
    if (/^(month|this month|monthly)$/.test(when)) return { kind: "sales", when: "month" };
    const date = asDate(when);
    if (date) return { kind: "sales", when: { date } };
    // "sale 5 bags cement to Ahmed" is not a question about takings — it is an
    // instruction to create one, which is the agent's job.
    return { kind: "agent", text };
  }

  // A document number, with or without the word "invoice": SI-0042, si 42.
  const invoice = /^(?:invoice|inv|bill|receipt)\b\s*[:#]?\s*(.*)$/i.exec(cleaned);
  if (invoice) {
    const number = subject(invoice[1]).replace(/\s+/g, "").toUpperCase();
    return number ? { kind: "invoice", number } : { kind: "help" };
  }
  if (/^[A-Z]{2}-?\d{2,}$/i.test(cleaned)) {
    return { kind: "invoice", number: cleaned.replace(/\s+/g, "").toUpperCase() };
  }

  return { kind: "agent", text };
}

// The reply to "help", and to a command that named no subject. Written as the
// shop would type rather than as a syntax listing — nobody reads a grammar.
export const HELP_TEXT = [
  "*What I can do*",
  "",
  "*Ask me*",
  "• `rate cement` — purchase and sales rates",
  "• `stock cement` — what's on hand, by location",
  "• `balance Ahmed` — what a customer owes",
  "• `due` — oldest unpaid invoices",
  "• `sales` / `sales yesterday` / `sales 25-12-2026`",
  "• `SI-0042` — one invoice",
  "",
  "*Tell me to do things*",
  "• `sale 5 bags cement to Ahmed`",
  "• `received 5000 from Bilal`",
  "• `expense 1200 fuel`",
  "• `purchase 20 bags cement from Lucky at 1600`",
  "",
  "Anything that changes data, I'll show you first and wait for *yes*.",
].join("\n");
