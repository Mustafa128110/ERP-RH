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
  | { kind: "agent"; text: string };

// A posting confirmation is intentionally stricter than a natural-language
// acknowledgement. "ok", "haan" or "confirm" can occur in ordinary chat;
// only an exact yes accepts the displayed draft.
const YES = new Set(["yes"]);
const NO = new Set(["n", "no", "cancel", "stop", "nahi", "nai", "nahin", "rehne", "chor"]);

function compact(text: string) { return text.trim().toLowerCase().replace(/[.!?]+$/g, ""); }
function subject(rest: string) {
  return rest.trim().replace(/^(?:of|for|on|about|ka|ki|ke)\s+/i, "").replace(/\s+(?:please|pls|plz|kya|hai|hy|h)\s*$/i, "").replace(/[?.!]+$/, "").trim();
}

function date(text: string): string | null {
  const match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(text.trim());
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  return `${match[3]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseCommand(raw: string): Command {
  const text = raw.trim();
  const exact = compact(text);
  if (!text || /^(help|menu|commands|\?)$/.test(exact)) return { kind: "help" };
  if (YES.has(exact)) return { kind: "confirm" };
  if (NO.has(exact)) return { kind: "cancel" };

  const cleaned = text.replace(/^(?:(?:please|pls|plz|kindly|can you|could you|show me|tell me|give me|check|find)\s+)+/i, "").trim();
  const lower = cleaned.toLowerCase();
  if (/^(due|dues|outstanding|receivable|receivables|udhaar|udhar)\b/.test(lower)) return { kind: "due" };

  const rate = /^(?:rate|rates|price|prices|bhao|bhaao)\b(.*)$/i.exec(cleaned);
  if (rate) return subject(rate[1]) ? { kind: "rate", query: subject(rate[1]) } : { kind: "help" };
  const stock = /^(?:stock|inventory|qty|quantity|available|maal)\b(.*)$/i.exec(cleaned);
  if (stock) return subject(stock[1]) ? { kind: "stock", query: subject(stock[1]) } : { kind: "help" };
  const balance = /^(?:balance|bal|owes?|khata|hisaab|hisab|ledger)\b(.*)$/i.exec(cleaned);
  if (balance) return subject(balance[1]) ? { kind: "balance", query: subject(balance[1]) } : { kind: "help" };

  const sales = /^(?:sales|sale|sold|takings|bikri)\b(.*)$/i.exec(cleaned);
  if (sales) {
    const when = subject(sales[1]).toLowerCase();
    if (!when || /^(today|aaj|aj)$/.test(when)) return { kind: "sales", when: "today" };
    if (/^(yesterday|kal)$/.test(when)) return { kind: "sales", when: "yesterday" };
    if (/^(month|this month|monthly)$/.test(when)) return { kind: "sales", when: "month" };
    const parsed = date(when);
    return parsed ? { kind: "sales", when: { date: parsed } } : { kind: "agent", text };
  }

  const invoice = /^(?:invoice|inv|bill|receipt)\b\s*[:#]?\s*(.*)$/i.exec(cleaned);
  if (invoice) {
    const number = subject(invoice[1]).replace(/\s+/g, "").toUpperCase();
    return number ? { kind: "invoice", number } : { kind: "help" };
  }
  if (/^[A-Z]{2}-?\d{2,}$/i.test(cleaned)) return { kind: "invoice", number: cleaned.replace(/\s+/g, "").toUpperCase() };
  return { kind: "agent", text };
}

export const HELP_TEXT = [
  "*ERP assistant*",
  "",
  "• rate cement",
  "• stock cement",
  "• balance Ahmed",
  "• due",
  "• sales / sales yesterday",
  "• SI-0042",
  "",
  "You can also describe a sale, payment, expense or stock purchase. I will show it and wait for an exact *yes* before anything is saved.",
].join("\n");
