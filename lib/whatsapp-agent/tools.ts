import "server-only";
import { getSession } from "@/lib/auth/session";
import { getScopeCompanyIds } from "@/lib/auth/scope";
import { getBankAccountOptions, getCashAccountOptions, getCompanies } from "@/lib/queries/lookups";
import { queryProductRates } from "@/lib/queries/products";
import { listStockLevels } from "@/lib/actions/stock";
import { listLedgerBalances } from "@/lib/actions/ledger";
import { createSale, listSales } from "@/lib/actions/sales";
import { createPayment } from "@/lib/actions/payments";
import { createExpense } from "@/lib/actions/expenses";
import { createStockPurchase } from "@/lib/actions/purchases";
import { runReport } from "@/lib/actions/reports";
import { isReportSlug, REPORT_TYPES } from "@/lib/report-constants";
import { money, qty, todayISO } from "@/lib/format";
import { bestMatches, chooseFrom } from "./match";

// What the agent is allowed to do, and the only things it is allowed to do.
//
// The model never writes SQL and never touches the database. It picks a tool
// from this file and supplies arguments; everything below routes through the
// same Server Actions the web UI posts to. That is the whole safety argument:
// createSale() here allocates a document number, moves stock, writes the ledger
// and records an audit entry identically to the sales page, because it *is* the
// sales page's code. A second write path for WhatsApp would be a second set of
// bugs and a second thing to keep in step.
//
// Permissions come free with that. Each action opens with requirePermission()
// against the session the inbound number resolved to
// (lib/whatsapp-agent/identity.ts), so a salesman who messages "expense 5000"
// gets the same refusal the Expenses page would give them.

// A read answers immediately. A write never does: it describes what it is about
// to do and waits to be told yes, because a misheard quantity that posts
// straight to the ledger is exactly the failure this feature could introduce.
export type ToolResult = { reply: string } | { confirm: string; commit: () => Promise<string> };

export interface ToolDef {
  name: string;
  description: string;
  // JSON Schema, passed to Gemini verbatim as a function declaration.
  parameters: { type: "object"; properties: Record<string, unknown>; required?: string[] };
  writes: boolean;
  run: (args: Record<string, string>) => Promise<ToolResult>;
}

// --- Shared resolution -------------------------------------------------------

const arg = (args: Record<string, string>, key: string) => String(args[key] ?? "").trim();
const amountOf = (raw: string) => {
  // "5,000", "5000 rs", "Rs. 5000" — strip everything that isn't part of a number.
  const n = Number(raw.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

class Ask extends Error {}
// Thrown when the agent cannot proceed without the user narrowing something
// down. Caught by `runTool` and returned as an ordinary reply — a question, not
// a failure.
function ask(question: string): never {
  throw new Ask(question);
}

async function resolveCompany(name?: string): Promise<{ id: string; name: string }> {
  const ids = await getScopeCompanyIds();
  const all = (await getCompanies()).filter((c) => ids.includes(c.id));
  if (all.length === 0) ask("You don't have access to any company.");

  if (name) {
    const hits = bestMatches(name, all, (c) => c.name);
    if (hits.length === 1) return { id: hits[0].id, name: hits[0].name };
    if (hits.length > 1) ask(chooseFrom("company", hits.map((c) => c.name)));
    ask(`No company matching "${name}".`);
  }
  // One company is the common case and asking about it every time would make
  // the bot useless. More than one and it must be said — a sale filed against
  // the wrong company is a reconciliation problem later.
  if (all.length === 1) return { id: all[0].id, name: all[0].name };
  ask(chooseFrom("company", all.map((c) => c.name)));
}

// Where the money lands. "cash" takes the company's default drawer; a bank name
// picks an account. Anything else is a question rather than a guess, because
// settling to the wrong account silently misstates two balances.
async function resolveSettlement(companyId: string, how: string) {
  const want = how.trim().toLowerCase();
  if (!want || want === "credit" || want === "udhaar" || want === "unpaid") return null;

  if (/^(cash|nakad|nagad)/.test(want)) {
    const accounts = (await getCashAccountOptions()).filter((a) => a.companyId === companyId);
    if (accounts.length === 0) ask("No cash account set up for this company.");
    const chosen = accounts.find((a) => a.isDefault) ?? accounts[0];
    return { settlementType: "cash" as const, cashAccountId: chosen.id, label: chosen.name };
  }

  const banks = await getBankAccountOptions();
  const hits = bestMatches(want, banks, (b) => b.name);
  if (hits.length === 1) return { settlementType: "account" as const, bankAccountId: hits[0].id, label: hits[0].name };
  if (hits.length > 1) ask(chooseFrom("account", hits.map((b) => b.name)));
  ask(`No account matching "${how}". Say "cash", or name a bank.`);
}

// Lines arrive from the model as JSON, and from the fast path as nothing at all.
// Anything that isn't a usable line is dropped here rather than deep inside
// createSale, so the confirmation the user sees is what will actually post.
interface LineInput {
  itemName?: string;
  quantity?: string | number;
  unitPrice?: string | number;
}
function readLines(raw: string): LineInput[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    ask("I couldn't read the items. Try: 5 bags cement at 1600.");
  }
  if (!Array.isArray(parsed)) ask("I couldn't read the items. Try: 5 bags cement at 1600.");
  const lines = (parsed as LineInput[]).filter((l) => l.itemName?.trim() && Number(l.quantity) > 0);
  if (lines.length === 0) ask("Which items, and how many?");
  return lines;
}

function lineSummary(lines: LineInput[]): { text: string; total: number } {
  const total = lines.reduce((sum, l) => sum + Number(l.quantity) * (Number(l.unitPrice) || 0), 0);
  const text = lines.map((l) => `• ${qty(Number(l.quantity))} × ${l.itemName} @ ${money(Number(l.unitPrice) || 0)}`).join("\n");
  return { text, total };
}

// Server Actions take FormData because that is what a form posts. Building one
// here is a small indignity in exchange for not forking every write path.
function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

// Every write funnels through this: it runs the real action and turns its
// ActionResult into a sentence. Actions never throw (lib/actions/guard.ts), so
// there is no error path here beyond reading `error`.
async function commitWith(run: () => Promise<{ error?: string } | undefined>, done: string): Promise<string> {
  const result = await run();
  if (result?.error) return `Not saved: ${result.error}`;
  return done;
}

// --- Reads -------------------------------------------------------------------

export async function itemRates(query: string): Promise<ToolResult> {
  const rows = await queryProductRates(await getScopeCompanyIds());
  const hits = bestMatches(query, rows, (r) => r.name);
  if (hits.length === 0) return { reply: `Nothing in the catalogue matching "${query}".` };
  if (hits.length > 1) return { reply: chooseFrom("item", hits.map((r) => r.name)) };

  const r = hits[0];
  const purchase = [r.purchaseRate1, r.purchaseRate2, r.purchaseRate3].filter(Boolean) as string[];
  return {
    reply: [
      `*${r.name}*${r.brand ? ` (${r.brand})` : ""}`,
      purchase.length ? `Purchase: ${purchase.map(money).join(" / ")}` : "Purchase: no history",
      `Last sold at: ${r.salesRate ? money(r.salesRate) : "never sold"}`,
      `On hand: ${r.onHand ? qty(r.onHand) : "0"}`,
    ].join("\n"),
  };
}

export async function itemStock(query: string): Promise<ToolResult> {
  const rows = await listStockLevels();
  const hits = bestMatches(query, rows, (r) => r.itemName);
  if (hits.length === 0) return { reply: `Nothing in the catalogue matching "${query}".` };
  if (hits.length > 1) return { reply: chooseFrom("item", hits.map((r) => r.itemName)) };

  const r = hits[0];
  const totals = r.unitTotals.map((u) => `${qty(u.onHand)} ${u.unit}`).join(", ") || "0";
  // The per-location split is the reason to ask a shop with a warehouse.
  const byLocation = r.breakdown.map((b) => `• ${b.location}: ${qty(b.onHand)} ${b.unit}`);
  return { reply: [`*${r.itemName}*`, `On hand: ${totals}`, ...byLocation].join("\n") };
}

export async function contactBalance(query: string): Promise<ToolResult> {
  const rows = await listLedgerBalances();
  const hits = bestMatches(query, rows, (r) => r.displayName);
  if (hits.length === 0) return { reply: `No ledger balance for anyone matching "${query}".` };
  if (hits.length > 1) return { reply: chooseFrom("contact", hits.map((r) => r.displayName)) };

  const r = hits[0];
  // balance = credit - debit: positive is a payable (we owe them), negative a
  // receivable (they owe us). Said in words, because the sign convention is not
  // something to make a person on a phone remember.
  const line =
    r.balance > 0
      ? `We owe them ${money(r.balance)}`
      : r.balance < 0
        ? `They owe us ${money(-r.balance)}`
        : "Settled — nothing outstanding";
  const recent = r.recentPayments.slice(0, 3).map((p) => `• ${p.date} ${p.number} ${money(p.amount)} ${p.direction}`);
  return { reply: [`*${r.displayName}* (${r.company})`, line, ...(recent.length ? ["", "Recent:", ...recent] : [])].join("\n") };
}

export async function outstandingDues(): Promise<ToolResult> {
  const rows = await listLedgerBalances();
  // Owed *to us*, biggest first. A list of everyone is not an answer; the top
  // few are what the question is actually about.
  const owing = rows.filter((r) => r.balance < 0).sort((a, b) => a.balance - b.balance).slice(0, 10);
  if (owing.length === 0) return { reply: "Nothing outstanding." };
  const total = owing.reduce((sum, r) => sum + -r.balance, 0);
  return {
    reply: [
      "*Outstanding*",
      ...owing.map((r) => `• ${r.displayName} — ${money(-r.balance)}`),
      "",
      `Total shown: ${money(total)}`,
    ].join("\n"),
  };
}

export async function salesSummary(from: string, to: string, label: string): Promise<ToolResult> {
  const sales = await listSales({ from, to });
  if (sales.length === 0) return { reply: `No sales ${label}.` };
  const total = sales.reduce((sum, s) => sum + Number(s.grandTotal ?? 0), 0);
  const unpaid = sales.filter((s) => !s.isPaid).length;
  return {
    reply: [
      `*Sales ${label}*`,
      `${sales.length} invoice${sales.length === 1 ? "" : "s"} — ${money(total)}`,
      unpaid ? `${unpaid} unpaid` : "All paid",
    ].join("\n"),
  };
}

export async function invoiceSummary(number: string): Promise<ToolResult> {
  const sales = await listSales();
  const hit = sales.find((s) => s.number?.toUpperCase() === number.toUpperCase());
  if (!hit) return { reply: `No invoice numbered ${number}.` };
  const lines = (hit.items ?? []).map((i) => `• ${qty(i.quantity)} × ${i.itemName} = ${money(i.lineTotal)}`);
  return {
    reply: [
      `*${hit.number}* — ${hit.customer ?? "Walk-in"}`,
      hit.documentDate,
      ...lines,
      "",
      `Total ${money(hit.grandTotal ?? 0)} · ${hit.isPaid ? "paid" : `${money(Number(hit.grandTotal ?? 0) - Number(hit.paidAmount ?? 0))} outstanding`}`,
    ].join("\n"),
  };
}

async function report(slug: string, from?: string, to?: string): Promise<ToolResult> {
  if (!isReportSlug(slug)) {
    return { reply: ["Which report?", ...REPORT_TYPES.map((r) => `• ${r.slug} — ${r.desc}`)].join("\n") };
  }
  const result = await runReport(slug, { from, to });
  if (result.rows.length === 0) return { reply: "Nothing in that report for those dates." };

  // WhatsApp has no table. The first three columns of the first ten rows is the
  // shape that survives a phone screen; the full thing lives on the website.
  const cols = result.columns.slice(0, 3);
  const body = result.rows.slice(0, 10).map((row) => cols.map((c) => row[c.key] ?? "—").join(" · "));
  const more = result.rows.length > 10 ? [`… and ${result.rows.length - 10} more rows on the website.`] : [];
  return { reply: [`*${slug}*`, cols.map((c) => c.label).join(" · "), ...body, ...more].join("\n") };
}

// --- Writes ------------------------------------------------------------------

async function draftSale(args: Record<string, string>): Promise<ToolResult> {
  const company = await resolveCompany(arg(args, "company") || undefined);
  const customer = arg(args, "customer");
  if (!customer) ask("Who is the customer?");
  const lines = readLines(arg(args, "lines") || "[]");
  const settle = await resolveSettlement(company.id, arg(args, "payment"));
  const { text, total } = lineSummary(lines);
  const date = arg(args, "date") || todayISO();

  return {
    confirm: [
      "*New sale*",
      `Customer: ${customer}`,
      text,
      `Total: ${money(total)}`,
      settle ? `Paid: ${settle.label}` : "On credit",
      `Company: ${company.name} · ${date}`,
      "",
      "Reply *yes* to post it.",
    ].join("\n"),
    commit: () =>
      commitWith(
        () =>
          createSale(
            undefined,
            form({
              companyId: company.id,
              documentDate: date,
              contactName: customer,
              linesJson: JSON.stringify(lines),
              // The web form's three-way Paid? control: settled in full, or not
              // settled at all. Part payments over WhatsApp are one ambiguity
              // too many — they can be entered as a payment afterwards.
              isPaid: settle ? "yes" : "no",
              settlementType: settle?.settlementType ?? "",
              ...(settle && "cashAccountId" in settle ? { cashAccountId: settle.cashAccountId } : {}),
              ...(settle && "bankAccountId" in settle ? { bankAccountId: settle.bankAccountId } : {}),
            }),
          ),
        `Sale posted for ${customer} — ${money(total)}.`,
      ),
  };
}

function draftPayment(direction: "received" | "made") {
  return async (args: Record<string, string>): Promise<ToolResult> => {
    const company = await resolveCompany(arg(args, "company") || undefined);
    const contact = arg(args, "contact");
    if (!contact) ask(direction === "received" ? "Received from whom?" : "Paid to whom?");
    const amount = amountOf(arg(args, "amount"));
    if (!amount) ask("How much?");
    // A payment that settles nowhere is not a payment — unlike a sale, there is
    // no "on credit" version of it.
    const settle = await resolveSettlement(company.id, arg(args, "payment") || "cash");
    if (!settle) ask('Into cash, or which account?');
    const date = arg(args, "date") || todayISO();

    return {
      confirm: [
        `*Payment ${direction}*`,
        `${direction === "received" ? "From" : "To"}: ${contact}`,
        `Amount: ${money(amount)}`,
        `${direction === "received" ? "Into" : "From"}: ${settle.label}`,
        `Company: ${company.name} · ${date}`,
        "",
        "Reply *yes* to post it.",
      ].join("\n"),
      commit: () =>
        commitWith(
          () =>
            createPayment(
              direction,
              undefined,
              form({
                companyId: company.id,
                contactName: contact,
                amount: String(amount),
                paymentDate: date,
                paymentType: settle.settlementType,
                ...("cashAccountId" in settle ? { cashAccountId: settle.cashAccountId } : {}),
                ...("bankAccountId" in settle ? { bankAccountId: settle.bankAccountId } : {}),
              }),
            ),
          `Payment ${direction} — ${money(amount)} ${direction === "received" ? "from" : "to"} ${contact}.`,
        ),
    };
  };
}

async function draftExpense(args: Record<string, string>): Promise<ToolResult> {
  const company = await resolveCompany(arg(args, "company") || undefined);
  const category = arg(args, "category");
  if (!category) ask("What was the expense for?");
  const amount = amountOf(arg(args, "amount"));
  if (!amount) ask("How much?");
  const settle = await resolveSettlement(company.id, arg(args, "payment") || "cash");
  if (!settle) ask("Paid from cash, or which account?");
  const date = arg(args, "date") || todayISO();

  return {
    confirm: [
      "*New expense*",
      `${category} — ${money(amount)}`,
      `Paid from: ${settle.label}`,
      `Company: ${company.name} · ${date}`,
      "",
      "Reply *yes* to post it.",
    ].join("\n"),
    commit: () =>
      commitWith(
        () =>
          createExpense(
            undefined,
            form({
              companyId: company.id,
              // Typed rather than picked: resolveExpenseCategoryId creates the
              // category if it's new, same as the Expenses page.
              expenseCategoryName: category,
              amount: String(amount),
              expenseDate: date,
              settlementType: settle.settlementType,
              notes: arg(args, "notes"),
              ...("cashAccountId" in settle ? { cashAccountId: settle.cashAccountId } : {}),
              ...("bankAccountId" in settle ? { bankAccountId: settle.bankAccountId } : {}),
            }),
          ),
        `Expense posted — ${category}, ${money(amount)}.`,
      ),
  };
}

async function draftPurchase(args: Record<string, string>): Promise<ToolResult> {
  const company = await resolveCompany(arg(args, "company") || undefined);
  const supplier = arg(args, "supplier");
  if (!supplier) ask("Which supplier?");
  const lines = readLines(arg(args, "lines") || "[]");
  const settle = await resolveSettlement(company.id, arg(args, "payment"));
  const { text, total } = lineSummary(lines);
  const date = arg(args, "date") || todayISO();

  return {
    confirm: [
      "*New stock purchase*",
      `Supplier: ${supplier}`,
      text,
      `Total: ${money(total)}`,
      settle ? `Paid: ${settle.label}` : "On credit",
      `Company: ${company.name} · ${date}`,
      "",
      "Reply *yes* to post it.",
    ].join("\n"),
    commit: () =>
      commitWith(
        () =>
          createStockPurchase(
            undefined,
            form({
              companyId: company.id,
              documentDate: date,
              contactName: supplier,
              // Purchase lines price into unit_cost, not unit_price — that is
              // what rate_list reads to build the three purchase rates.
              linesJson: JSON.stringify(lines.map((l) => ({ ...l, unitCost: l.unitPrice }))),
              documentTypeMode: "existing",
              isPaid: settle ? "yes" : "no",
              settlementType: settle?.settlementType ?? "",
              ...(settle && "cashAccountId" in settle ? { cashAccountId: settle.cashAccountId } : {}),
              ...(settle && "bankAccountId" in settle ? { bankAccountId: settle.bankAccountId } : {}),
            }),
          ),
        `Purchase posted from ${supplier} — ${money(total)}.`,
      ),
  };
}

// --- The catalogue the model sees -------------------------------------------

const str = (description: string) => ({ type: "string", description });

export const TOOLS: ToolDef[] = [
  {
    name: "item_rates",
    description: "Purchase rates and last selling rate for one product.",
    parameters: { type: "object", properties: { item: str("Product name as the user said it") }, required: ["item"] },
    writes: false,
    run: (a) => itemRates(arg(a, "item")),
  },
  {
    name: "item_stock",
    description: "Quantity on hand for one product, split by location.",
    parameters: { type: "object", properties: { item: str("Product name") }, required: ["item"] },
    writes: false,
    run: (a) => itemStock(arg(a, "item")),
  },
  {
    name: "contact_balance",
    description: "What one customer or supplier owes, or is owed.",
    parameters: { type: "object", properties: { contact: str("Customer or supplier name") }, required: ["contact"] },
    writes: false,
    run: (a) => contactBalance(arg(a, "contact")),
  },
  {
    name: "outstanding_dues",
    description: "Everyone who currently owes the business money, largest first.",
    parameters: { type: "object", properties: {} },
    writes: false,
    run: () => outstandingDues(),
  },
  {
    name: "sales_summary",
    description: "Invoice count and total for a date range.",
    parameters: {
      type: "object",
      properties: { from: str("Start date, YYYY-MM-DD"), to: str("End date, YYYY-MM-DD") },
      required: ["from", "to"],
    },
    writes: false,
    run: (a) => {
      const from = arg(a, "from") || todayISO();
      const to = arg(a, "to") || from;
      return salesSummary(from, to, from === to ? `on ${from}` : `${from} to ${to}`);
    },
  },
  {
    name: "invoice_summary",
    description: "One invoice by its number: customer, lines, total, what is outstanding.",
    parameters: { type: "object", properties: { number: str("Invoice number, e.g. SI-0042") }, required: ["number"] },
    writes: false,
    run: (a) => invoiceSummary(arg(a, "number")),
  },
  {
    name: "run_report",
    description: `One of the built-in reports: ${REPORT_TYPES.map((r) => r.slug).join(", ")}.`,
    parameters: {
      type: "object",
      properties: { report: str("Report slug"), from: str("Start date, YYYY-MM-DD"), to: str("End date, YYYY-MM-DD") },
      required: ["report"],
    },
    writes: false,
    run: (a) => report(arg(a, "report"), arg(a, "from") || undefined, arg(a, "to") || undefined),
  },
  {
    name: "create_sale",
    description: "Raise a sales invoice. Always confirmed with the user before it posts.",
    parameters: {
      type: "object",
      properties: {
        customer: str("Customer name"),
        lines: str('JSON array: [{"itemName":"Cement","quantity":"5","unitPrice":"1600"}]'),
        payment: str('How it was settled: "cash", a bank name, or "credit" if unpaid'),
        company: str("Company name, only if the user named one"),
        date: str("YYYY-MM-DD, defaults to today"),
      },
      required: ["customer", "lines"],
    },
    writes: true,
    run: draftSale,
  },
  {
    name: "record_payment_received",
    description: "Record money received from a customer.",
    parameters: {
      type: "object",
      properties: {
        contact: str("Who paid"),
        amount: str("Amount"),
        payment: str('"cash" or a bank name'),
        company: str("Company name, only if the user named one"),
        date: str("YYYY-MM-DD, defaults to today"),
      },
      required: ["contact", "amount"],
    },
    writes: true,
    run: draftPayment("received"),
  },
  {
    name: "record_payment_made",
    description: "Record money paid out to a supplier.",
    parameters: {
      type: "object",
      properties: {
        contact: str("Who was paid"),
        amount: str("Amount"),
        payment: str('"cash" or a bank name'),
        company: str("Company name, only if the user named one"),
        date: str("YYYY-MM-DD, defaults to today"),
      },
      required: ["contact", "amount"],
    },
    writes: true,
    run: draftPayment("made"),
  },
  {
    name: "record_expense",
    description: "Record a business expense.",
    parameters: {
      type: "object",
      properties: {
        category: str("What it was for, e.g. fuel, rent, salaries"),
        amount: str("Amount"),
        payment: str('"cash" or a bank name'),
        notes: str("Anything else worth recording"),
        company: str("Company name, only if the user named one"),
        date: str("YYYY-MM-DD, defaults to today"),
      },
      required: ["category", "amount"],
    },
    writes: true,
    run: draftExpense,
  },
  {
    name: "create_stock_purchase",
    description: "Record stock bought from a supplier. Increases inventory.",
    parameters: {
      type: "object",
      properties: {
        supplier: str("Supplier name"),
        lines: str('JSON array: [{"itemName":"Cement","quantity":"20","unitPrice":"1600"}]'),
        payment: str('"cash", a bank name, or "credit" if unpaid'),
        company: str("Company name, only if the user named one"),
        date: str("YYYY-MM-DD, defaults to today"),
      },
      required: ["supplier", "lines"],
    },
    writes: true,
    run: draftPurchase,
  },
];

export const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

// The single entry point. Turns an `ask()` into a question and any genuine
// failure into a sentence — the webhook must always have something to reply
// with, because a WhatsApp message that goes unanswered looks like the system is
// down.
export async function runTool(name: string, args: Record<string, string>): Promise<ToolResult> {
  const tool = TOOL_BY_NAME.get(name);
  if (!tool) return { reply: "I don't know how to do that yet." };

  // Belt and braces: identity.ts resolved a real active user, but a tool that
  // somehow runs without one must not reach an action that assumes a session.
  if (!(await getSession())) return { reply: "I couldn't work out who you are." };

  try {
    return await tool.run(args);
  } catch (e) {
    if (e instanceof Ask) return { reply: e.message };
    // PermissionError included: the user is told plainly rather than being
    // handed a stack trace or, worse, silence.
    const message = e instanceof Error ? e.message : "Something went wrong.";
    console.error(`[whatsapp-agent] ${name} failed:`, e);
    return { reply: `Couldn't do that — ${message}` };
  }
}
