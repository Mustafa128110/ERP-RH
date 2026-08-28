import "server-only";
import { getSession } from "@/lib/auth/session";
import { getScopeCompanyIds } from "@/lib/auth/scope";
import { createExpense } from "@/lib/actions/expenses";
import { listLedgerBalances } from "@/lib/actions/ledger";
import { createPayment } from "@/lib/actions/payments";
import { createStockPurchase } from "@/lib/actions/purchases";
import { runReport } from "@/lib/actions/reports";
import { createSale, listSales } from "@/lib/actions/sales";
import { listStockLevels } from "@/lib/actions/stock";
import { money, qty, todayISO } from "@/lib/format";
import { isReportSlug, REPORT_TYPES, type ReportSlug } from "@/lib/report-constants";
import { queryProductRates } from "@/lib/queries/products";
import { resolveDocumentTax } from "@/lib/queries/document-tax";
import { getBankAccountOptions, getCashAccountOptions, getCompanies, getContactOptions, getDocumentTypes, getExpenseCategories, getItemOptions, getLocations } from "@/lib/queries/lookups";
import { bestMatches, chooseFrom } from "./match";
import type { PendingDraft } from "./state";
import { OPERATION_ID_FIELD } from "@/lib/operation-constants";

export type ToolResult = { reply: string } | { draft: { tool: string; fields: Record<string, string>; confirmation: string } };
export type ToolArgs = Record<string, unknown>;

export type ToolDeclaration = {
  name: string;
  description: string;
  parameters: { type: "object"; properties: Record<string, unknown>; required?: string[] };
};

type Tool = ToolDeclaration & { run: (args: ToolArgs) => Promise<ToolResult> };
const str = (description: string) => ({ type: "string", description });
const dateOf = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : todayISO();
const text = (args: ToolArgs, name: string) => typeof args[name] === "string" ? args[name].trim() : "";
const form = (fields: Record<string, string>) => {
  const output = new FormData();
  for (const [key, value] of Object.entries(fields)) output.set(key, value);
  return output;
};

class Ask extends Error {}
function ask(message: string): never { throw new Ask(message); }

async function resolveCompany(name: string) {
  const rows = await getCompanies();
  if (rows.length === 0) ask("You do not have access to any company.");
  if (!name && rows.length === 1) return rows[0];
  const hits = bestMatches(name, rows, (row) => row.name);
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) ask(chooseFrom("company", hits.map((row) => row.name)));
  ask(name ? `No company matches "${name}".` : chooseFrom("company", rows.map((row) => row.name)));
}

async function resolveContact(companyId: string, name: string) {
  if (!name) ask("Which customer or supplier?");
  const rows = (await getContactOptions()).filter((row) => !row.companyId || row.companyId === companyId);
  const hits = bestMatches(name, rows, (row) => row.displayName);
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) ask(chooseFrom("contact", hits.map((row) => row.displayName)));
  ask(`No existing contact matches "${name}". Add it in the ERP first.`);
}

type AgentLine = { item: string; quantity: number; unitPrice: number };
function readLines(args: ToolArgs): AgentLine[] {
  const value = args.lines;
  if (!Array.isArray(value)) ask("List the items, quantity and price.");
  const lines = value.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const candidate = row as Record<string, unknown>;
    const item = typeof candidate.item === "string" ? candidate.item.trim() : "";
    const quantity = Number(candidate.quantity);
    const unitPrice = Number(candidate.unitPrice);
    return item && Number.isFinite(quantity) && quantity > 0 && Number.isFinite(unitPrice) && unitPrice >= 0 ? [{ item, quantity, unitPrice }] : [];
  });
  if (lines.length === 0) ask("List the items, quantity and price.");
  return lines;
}

async function resolveLines(companyId: string, lines: AgentLine[]) {
  const options = (await getItemOptions()).filter((row) => row.companyId === companyId);
  return lines.map((line) => {
    const hits = bestMatches(line.item, options, (row) => row.name);
    if (hits.length === 1) return { ...line, itemId: hits[0].id, itemName: hits[0].name };
    if (hits.length > 1) ask(chooseFrom("item", hits.map((row) => row.name)));
    ask(`No existing item matches "${line.item}". Add it in the ERP first.`);
  });
}

async function resolveSettlement(companyId: string, raw: string, required: boolean) {
  const wanted = raw.toLowerCase();
  if (!wanted || /^(credit|udhaar|unpaid)$/.test(wanted)) {
    if (required) ask("Say cash or name the bank account.");
    return null;
  }
  if (/^(cash|nakad|nagad)$/.test(wanted)) {
    const rows = (await getCashAccountOptions()).filter((row) => row.companyId === companyId);
    const chosen = rows.find((row) => row.isDefault) ?? rows[0];
    if (!chosen) ask("No cash account is set up for this company.");
    return { type: "cash", field: "cashAccountId", id: chosen.id, label: chosen.name } as const;
  }
  const rows = (await getBankAccountOptions()).filter((row) => row.companyId === companyId);
  const hits = bestMatches(raw, rows, (row) => row.name);
  if (hits.length === 1) return { type: "account", field: "bankAccountId", id: hits[0].id, label: hits[0].name } as const;
  if (hits.length > 1) ask(chooseFrom("account", hits.map((row) => row.name)));
  ask(`No account matches "${raw}".`);
}

async function itemRates(query: string): Promise<ToolResult> {
  const rows = await queryProductRates(await getScopeCompanyIds());
  const hits = bestMatches(query, rows, (row) => row.name);
  if (hits.length === 0) return { reply: `Nothing in the catalogue matches "${query}".` };
  if (hits.length > 1) return { reply: chooseFrom("item", hits.map((row) => row.name)) };
  const item = hits[0];
  const purchase = [item.purchaseRate1, item.purchaseRate2, item.purchaseRate3].filter(Boolean).map((value) => money(value!));
  return { reply: [`*${item.name}*`, purchase.length ? `Purchase: ${purchase.join(" / ")}` : "Purchase: no history", `Last sold: ${item.salesRate ? money(item.salesRate) : "never sold"}`, `On hand: ${item.onHand ? qty(item.onHand) : "0"}`].join("\n") };
}

async function itemStock(query: string): Promise<ToolResult> {
  const rows = await listStockLevels();
  const hits = bestMatches(query, rows, (row) => row.itemName);
  if (hits.length === 0) return { reply: `Nothing in stock matches "${query}".` };
  if (hits.length > 1) return { reply: chooseFrom("item", hits.map((row) => row.itemName)) };
  const item = hits[0];
  return { reply: [`*${item.itemName}*`, `On hand: ${item.unitTotals.map((unit) => `${qty(unit.onHand)} ${unit.unit}`).join(", ") || "0"}`, ...item.breakdown.map((row) => `• ${row.location}: ${qty(row.onHand)} ${row.unit}`)].join("\n") };
}

async function balance(query: string): Promise<ToolResult> {
  const rows = await listLedgerBalances();
  const hits = bestMatches(query, rows, (row) => row.displayName);
  if (hits.length === 0) return { reply: `No balance matches "${query}".` };
  if (hits.length > 1) return { reply: chooseFrom("contact", hits.map((row) => row.displayName)) };
  const row = hits[0];
  const statement = row.balance > 0 ? `We owe them ${money(row.balance)}` : row.balance < 0 ? `They owe us ${money(-row.balance)}` : "Settled — nothing outstanding";
  return { reply: `*${row.displayName}* (${row.company})\n${statement}` };
}

async function dues(): Promise<ToolResult> {
  const rows = (await listLedgerBalances()).filter((row) => row.balance < 0).sort((left, right) => left.balance - right.balance).slice(0, 10);
  if (rows.length === 0) return { reply: "Nothing is outstanding." };
  return { reply: ["*Outstanding*", ...rows.map((row) => `• ${row.displayName} — ${money(-row.balance)}`), "", `Total shown: ${money(rows.reduce((sum, row) => sum - row.balance, 0))}`].join("\n") };
}

async function salesSummary(from: string, to: string, label: string): Promise<ToolResult> {
  const rows = await listSales({ from, to });
  if (rows.length === 0) return { reply: `No sales ${label}.` };
  const total = rows.reduce((sum, row) => sum + Number(row.grandTotal ?? 0), 0);
  return { reply: `*Sales ${label}*\n${rows.length} invoice${rows.length === 1 ? "" : "s"} — ${money(total)}` };
}

async function invoiceSummary(number: string): Promise<ToolResult> {
  const row = (await listSales()).find((sale) => sale.number?.toUpperCase() === number.toUpperCase());
  if (!row) return { reply: `No invoice numbered ${number}.` };
  return { reply: [`*${row.number}* — ${row.customer ?? "Walk-in"}`, row.documentDate, ...(row.items ?? []).map((line) => `• ${qty(line.quantity)} × ${line.itemName} = ${money(line.lineTotal)}`), "", `Total ${money(row.grandTotal ?? 0)}`].join("\n") };
}

async function draftSale(args: ToolArgs): Promise<ToolResult> {
  const company = await resolveCompany(text(args, "company"));
  const contact = await resolveContact(company.id, text(args, "customer"));
  const lines = await resolveLines(company.id, readLines(args));
  const settlement = await resolveSettlement(company.id, text(args, "payment"), false);
  const tax = await resolveDocumentTax(company.id, null, lines.map((line) => ({ itemId: line.itemId, lineTotal: line.quantity * line.unitPrice })), 0, 0);
  const fields: Record<string, string> = {
    companyId: company.id,
    documentDate: dateOf(text(args, "date")),
    contactId: contact.id,
    linesJson: JSON.stringify(lines.map((line) => ({ itemId: line.itemId, itemName: line.itemName, locationId: "", unitId: "", unitName: "", quantity: String(line.quantity), unitPrice: String(line.unitPrice), unitCost: "" }))),
    isPaid: settlement ? "yes" : "no",
    settlementType: settlement?.type ?? "",
    ...(settlement ? { [settlement.field]: settlement.id } : {}),
  };
  return { draft: { tool: "create_sale", fields, confirmation: ["*New sale*", `Customer: ${contact.displayName}`, ...lines.map((line) => `• ${qty(line.quantity)} × ${line.itemName} @ ${money(line.unitPrice)}`), `Total: ${money(tax.grandTotal)}${tax.taxRate ? ` (includes tax ${money(tax.taxTotal)})` : ""}`, settlement ? `Paid: ${settlement.label}` : "On credit", `Company: ${company.name}`, "", "Reply *yes* to post it."].join("\n") } };
}

async function draftPayment(direction: "received" | "made", args: ToolArgs): Promise<ToolResult> {
  const company = await resolveCompany(text(args, "company"));
  const contact = await resolveContact(company.id, text(args, "contact"));
  const amount = Number(text(args, "amount").replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) ask("How much?");
  const settlement = await resolveSettlement(company.id, text(args, "payment") || "cash", true);
  const fields: Record<string, string> = { companyId: company.id, contactId: contact.id, amount: String(amount), paymentDate: dateOf(text(args, "date")), paymentType: settlement!.type, [settlement!.field]: settlement!.id };
  return { draft: { tool: direction === "received" ? "record_payment_received" : "record_payment_made", fields, confirmation: [`*Payment ${direction}*`, `${direction === "received" ? "From" : "To"}: ${contact.displayName}`, `Amount: ${money(amount)}`, `${direction === "received" ? "Into" : "From"}: ${settlement!.label}`, `Company: ${company.name}`, "", "Reply *yes* to post it."].join("\n") } };
}

async function draftExpense(args: ToolArgs): Promise<ToolResult> {
  const company = await resolveCompany(text(args, "company"));
  const categoryName = text(args, "category");
  const categories = (await getExpenseCategories()).filter((row) => row.companyId === company.id);
  const hits = bestMatches(categoryName, categories, (row) => row.name);
  if (hits.length === 0) ask(`No existing expense category matches "${categoryName}".`);
  if (hits.length > 1) ask(chooseFrom("expense category", hits.map((row) => row.name)));
  const amount = Number(text(args, "amount").replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) ask("How much?");
  const settlement = await resolveSettlement(company.id, text(args, "payment") || "cash", true);
  const category = hits[0]!;
  const fields: Record<string, string> = { companyId: company.id, expenseCategoryId: category.id, amount: String(amount), expenseDate: dateOf(text(args, "date")), settlementType: settlement!.type, [settlement!.field]: settlement!.id, notes: text(args, "notes") };
  return { draft: { tool: "record_expense", fields, confirmation: ["*New expense*", `${category.name} — ${money(amount)}`, `Paid from: ${settlement!.label}`, `Company: ${company.name}`, "", "Reply *yes* to post it."].join("\n") } };
}

async function draftPurchase(args: ToolArgs): Promise<ToolResult> {
  const company = await resolveCompany(text(args, "company"));
  const supplier = await resolveContact(company.id, text(args, "supplier"));
  const lines = await resolveLines(company.id, readLines(args));
  const session = await getSession();
  const locations = (await getLocations()).filter((row) => !session?.warehouseIds.length || session.warehouseIds.includes(row.id));
  const locationHits = bestMatches(text(args, "location"), locations, (row) => row.name);
  if (locationHits.length !== 1) ask(locationHits.length ? chooseFrom("location", locationHits.map((row) => row.name)) : "Which location received the stock?");
  const types = (await getDocumentTypes()).filter((row) => row.companyId === company.id && row.active && row.affectsPayable);
  const type = types.find((row) => row.code === "PURCHASE_INVOICE") ?? (types.length === 1 ? types[0] : null);
  if (!type) ask("Set up a purchase invoice document type in the ERP first.");
  const settlement = await resolveSettlement(company.id, text(args, "payment"), false);
  const tax = await resolveDocumentTax(company.id, null, lines.map((line) => ({ itemId: line.itemId, lineTotal: line.quantity * line.unitPrice })), 0, 0);
  const fields: Record<string, string> = { companyId: company.id, documentDate: dateOf(text(args, "date")), contactId: supplier.id, locationId: locationHits[0].id, documentTypeMode: "existing", documentTypeId: String(type.id), linesJson: JSON.stringify(lines.map((line) => ({ itemId: line.itemId, itemName: line.itemName, unitId: "", unitName: "", quantity: String(line.quantity), unitPrice: String(line.unitPrice), unitCost: String(line.unitPrice) }))), isPaid: settlement ? "yes" : "no", settlementType: settlement?.type ?? "", ...(settlement ? { [settlement.field]: settlement.id } : {}) };
  return { draft: { tool: "create_stock_purchase", fields, confirmation: ["*New stock purchase*", `Supplier: ${supplier.displayName}`, `Location: ${locationHits[0].name}`, ...lines.map((line) => `• ${qty(line.quantity)} × ${line.itemName} @ ${money(line.unitPrice)}`), `Total: ${money(tax.grandTotal)}`, settlement ? `Paid: ${settlement.label}` : "On credit", `Company: ${company.name}`, "", "Reply *yes* to post it."].join("\n") } };
}

const tools: Tool[] = [
  { name: "item_rates", description: "Purchase and sale rates for one product.", parameters: { type: "object", properties: { item: str("Product name") }, required: ["item"] }, run: (args) => itemRates(text(args, "item")) },
  { name: "item_stock", description: "Stock on hand for one product.", parameters: { type: "object", properties: { item: str("Product name") }, required: ["item"] }, run: (args) => itemStock(text(args, "item")) },
  { name: "contact_balance", description: "Balance for a customer or supplier.", parameters: { type: "object", properties: { contact: str("Contact name") }, required: ["contact"] }, run: (args) => balance(text(args, "contact")) },
  { name: "outstanding_dues", description: "Outstanding customer receivables.", parameters: { type: "object", properties: {} }, run: () => dues() },
  { name: "sales_summary", description: "Sales total for a date range.", parameters: { type: "object", properties: { from: str("Start YYYY-MM-DD"), to: str("End YYYY-MM-DD") }, required: ["from", "to"] }, run: (args) => { const from = dateOf(text(args, "from")); const to = dateOf(text(args, "to") || from); return salesSummary(from, to, from === to ? `on ${from}` : `${from} to ${to}`); } },
  { name: "invoice_summary", description: "Summary of an invoice by number.", parameters: { type: "object", properties: { number: str("Invoice number") }, required: ["number"] }, run: (args) => invoiceSummary(text(args, "number")) },
  { name: "run_report", description: `One ERP report: ${REPORT_TYPES.map((row) => row.slug).join(", ")}.`, parameters: { type: "object", properties: { report: str("Report slug"), from: str("Start YYYY-MM-DD"), to: str("End YYYY-MM-DD") }, required: ["report"] }, run: async (args) => { const report = text(args, "report"); if (!isReportSlug(report)) return { reply: "Which report? " + REPORT_TYPES.map((row) => row.slug).join(", ") }; const result = await runReport(report as ReportSlug, { from: text(args, "from") || undefined, to: text(args, "to") || undefined }); return { reply: result.rows.length ? [`*${result.title}*`, ...result.rows.slice(0, 10).map((row) => result.columns.slice(0, 3).map((column) => String(row[column.key] ?? "—")).join(" · "))].join("\n") : "Nothing in that report." }; } },
  { name: "create_sale", description: "Draft a sale. It is never posted until the user replies with exact yes.", parameters: { type: "object", properties: { customer: str("Existing customer"), lines: { type: "array", items: { type: "object", properties: { item: str("Existing item"), quantity: { type: "number" }, unitPrice: { type: "number" } }, required: ["item", "quantity", "unitPrice"] } }, payment: str("cash, bank name or credit"), company: str("Company if specified"), date: str("YYYY-MM-DD") }, required: ["customer", "lines"] }, run: draftSale },
  { name: "record_payment_received", description: "Draft money received from an existing customer.", parameters: { type: "object", properties: { contact: str("Existing contact"), amount: str("Amount"), payment: str("cash or bank"), company: str("Company"), date: str("YYYY-MM-DD") }, required: ["contact", "amount"] }, run: (args) => draftPayment("received", args) },
  { name: "record_payment_made", description: "Draft money paid to an existing supplier.", parameters: { type: "object", properties: { contact: str("Existing contact"), amount: str("Amount"), payment: str("cash or bank"), company: str("Company"), date: str("YYYY-MM-DD") }, required: ["contact", "amount"] }, run: (args) => draftPayment("made", args) },
  { name: "record_expense", description: "Draft an expense under an existing category.", parameters: { type: "object", properties: { category: str("Existing expense category"), amount: str("Amount"), payment: str("cash or bank"), company: str("Company"), date: str("YYYY-MM-DD"), notes: str("Optional note") }, required: ["category", "amount"] }, run: draftExpense },
  { name: "create_stock_purchase", description: "Draft a stock purchase. It is never posted until exact yes.", parameters: { type: "object", properties: { supplier: str("Existing supplier"), lines: { type: "array", items: { type: "object", properties: { item: str("Existing item"), quantity: { type: "number" }, unitPrice: { type: "number" } }, required: ["item", "quantity", "unitPrice"] } }, location: str("Receiving location"), payment: str("cash, bank name or credit"), company: str("Company"), date: str("YYYY-MM-DD") }, required: ["supplier", "lines", "location"] }, run: draftPurchase },
  { name: "unsupported_request", description: "Use when the request is outside the available ERP assistant functions.", parameters: { type: "object", properties: {} }, run: async () => ({ reply: "I can help with rates, stock, balances, dues, sales, invoices, and drafting sales, payments, expenses or stock purchases." }) },
];

export const TOOL_DECLARATIONS: ToolDeclaration[] = tools.map(({ name, description, parameters }) => ({ name, description, parameters }));
const byName = new Map(tools.map((tool) => [tool.name, tool]));

export async function runTool(name: string, args: ToolArgs): Promise<ToolResult> {
  const tool = byName.get(name);
  if (!tool) return { reply: "I cannot do that." };
  if (!(await getSession())) return { reply: "I could not work out who you are." };
  try { return await tool.run(args); } catch (error) {
    if (error instanceof Ask) return { reply: error.message };
    console.error("[whatsapp-agent] tool failed", { tool: name, error: error instanceof Error ? error.message : "unknown" });
    return { reply: "I could not complete that. Try again or use the ERP." };
  }
}

// Posting remains inside the same guarded Server Actions as the web forms. The
// WhatsApp layer supplies only an already-reviewed FormData and the idempotency
// key tied to the inbound provider message.
export async function commitDraft(draft: PendingDraft): Promise<string> {
  const fields = { ...draft.fields, [OPERATION_ID_FIELD]: draft.operationId };
  let result: { error?: string; success?: boolean };
  switch (draft.tool) {
    case "create_sale":
      result = await createSale(undefined, form(fields));
      break;
    case "record_payment_received":
      result = await createPayment("received", undefined, form(fields));
      break;
    case "record_payment_made":
      result = await createPayment("made", undefined, form(fields));
      break;
    case "record_expense":
      result = await createExpense(undefined, form(fields));
      break;
    case "create_stock_purchase":
      result = await createStockPurchase(undefined, form(fields));
      break;
    default:
      return "That draft is no longer supported. Please start again.";
  }
  return result.error ? `Not saved: ${result.error}` : "Saved successfully.";
}
