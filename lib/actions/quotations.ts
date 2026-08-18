"use server";

import { and, desc, eq, getTableColumns, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { companies, contacts, documentLines, documentNumberLedger, documentTypes, documents, items, units } from "@/lib/db/schema";
import { getLiveSession, getSession } from "@/lib/auth/session";
import { requirePermission } from "@/lib/auth/permissions";
import { companyInPermissionScope, companyInScope } from "@/lib/auth/scope";
import { CACHE, invalidateLookups } from "@/lib/queries/lookups";
import { ensureDocumentType, nextDocumentNumber } from "@/lib/actions/document-numbering";
import { resolveContactId, resolveItemIds, resolveUnitIds } from "@/lib/actions/resolve-refs";
import { round1, todayISO } from "@/lib/format";
import { guard, DUPLICATE, type ActionResult } from "@/lib/actions/guard";
import { recordAudit } from "@/lib/actions/audit";
import { createSale } from "@/lib/actions/sales";
import { claimOperation, readOperationId, DuplicateOperationError } from "@/lib/actions/operation-id";
import { financialDocumentError } from "@/lib/financial-input";

// A quotation is an ordinary document of type QUOTATION — the universal model
// already had the type and the QT series, so this needed three nullable columns
// rather than tables of its own (migration 0045):
//
//   documents.valid_until              when the quoted prices stop being honoured
//   documents.source_document_id       set on the invoice a quotation becomes
//   document_lines.converted_quantity  how much of a line has been invoiced
//
// That last one is what makes partial conversion work, which is the whole point:
// a builder takes half the tiles now and the rest when the second floor is ready,
// and the quotation has to keep saying what is still outstanding on it.
//
// Nothing here moves stock or touches the ledger. A quotation is a promise about
// price, not a transaction — the stock and the money happen when it converts,
// through createSale, which is the only thing in this app that knows how to make
// a sale properly.

function quotationType(companyId: string) {
  return ensureDocumentType({
    companyId,
    code: "QUOTATION",
    name: "Quotation",
    series: "QT",
    // All four false, deliberately: a quotation is not stock, not money, not owed
    // and not owing until it becomes an invoice.
    affectsInventory: false,
    affectsAccounting: false,
    affectsReceivable: false,
    affectsPayable: false,
    active: true,
  });
}

export type QuotationLine = {
  itemId: string;
  itemName: string;
  unitId: string;
  unitName: string;
  quantity: string;
  unitPrice: string;
  convertedQuantity: string;
};

export type QuotationListRow = {
  id: string;
  number: string;
  company: string;
  companyId: string;
  customer: string | null;
  documentDate: string;
  validUntil: string | null;
  grandTotal: string;
  // Derived, not stored: a quotation's state is a fact about its lines, and a
  // stored copy is a second version of the truth waiting to disagree.
  status: "Open" | "Partly converted" | "Converted" | "Expired";
  // What was quoted, for the hover panel — name, how much, how much of it has
  // been invoiced already.
  lines: { name: string; quantity: string; converted: string }[];
};

// Open / partly converted / converted, plus expiry. Expiry loses to conversion:
// something already invoiced is converted, whatever its validity date says.
function statusOf(quoted: number, converted: number, validUntil: string | null): QuotationListRow["status"] {
  if (converted > 0 && converted >= quoted) return "Converted";
  if (validUntil && validUntil < todayISO()) return "Expired";
  if (converted > 0) return "Partly converted";
  return "Open";
}

export async function listQuotations(): Promise<QuotationListRow[]> {
  const session = await getSession();
  requirePermission(session, "quotations", "view");
  const scope = await companyInPermissionScope(documents.companyId, session, "quotations");

  // The line totals come back as an aggregate rather than as rows: the list only
  // needs "how much of this is converted", and pulling every line of every
  // quotation to add them up in JS is the same answer for a great deal more wire.
  const rows = await db
    .select({
      id: documents.id,
      number: documents.number,
      companyId: documents.companyId,
      company: companies.name,
      customer: contacts.displayName,
      documentDate: documents.documentDate,
      validUntil: documents.validUntil,
      grandTotal: documents.grandTotal,
      quoted: sql<string>`coalesce(sum(${documentLines.quantity}), 0)`,
      converted: sql<string>`coalesce(sum(${documentLines.convertedQuantity}), 0)`,
      // The lines, for the hover panel on the number. Aggregated in the same
      // pass rather than fetched per row — "what is on this quotation" is the
      // question you ask while scanning the list, and a query per row to answer
      // it is the shape that makes a list slow.
      lines: sql<{ name: string | null; quantity: string; converted: string | null }[]>`
        coalesce(
          json_agg(
            json_build_object('name', ${items.name}, 'quantity', ${documentLines.quantity}, 'converted', ${documentLines.convertedQuantity})
            ORDER BY ${documentLines.lineNo}
          ) FILTER (WHERE ${documentLines.id} IS NOT NULL),
          '[]'::json
        )`,
    })
    .from(documents)
    .innerJoin(documentTypes, eq(documentTypes.id, documents.documentTypeId))
    .innerJoin(companies, eq(companies.id, documents.companyId))
    .leftJoin(contacts, eq(contacts.id, documents.contactId))
    .leftJoin(documentLines, eq(documentLines.documentId, documents.id))
    .leftJoin(items, eq(items.id, documentLines.itemId))
    .where(and(eq(documentTypes.code, "QUOTATION"), scope))
    .groupBy(documents.id, companies.name, contacts.displayName)
    .orderBy(desc(documents.documentDate), desc(documents.createdAt));

  return rows.map((r) => ({
    id: r.id,
    number: r.number,
    companyId: r.companyId,
    company: r.company,
    customer: r.customer,
    documentDate: r.documentDate,
    validUntil: r.validUntil,
    grandTotal: r.grandTotal,
    status: statusOf(Number(r.quoted), Number(r.converted), r.validUntil),
    lines: (r.lines ?? []).map((l) => ({
      name: l.name ?? "—",
      quantity: l.quantity,
      converted: l.converted ?? "0",
    })),
  }));
}

export async function getQuotation(documentId: string) {
  const session = await getSession();
  requirePermission(session, "quotations", "view");

  // Both only need the id we were handed, so they share one round trip.
  const [[doc], lineRows] = await Promise.all([
    db
      .select(getTableColumns(documents))
      .from(documents)
      .innerJoin(documentTypes, eq(documentTypes.id, documents.documentTypeId))
      .where(and(eq(documents.id, documentId), eq(documentTypes.code, "QUOTATION"), await companyInPermissionScope(documents.companyId, session, "quotations")))
      .limit(1),
    db
      .select({
        itemId: documentLines.itemId,
        itemName: items.name,
        unitId: documentLines.unitId,
        unitName: units.name,
        quantity: documentLines.quantity,
        unitPrice: documentLines.unitPrice,
        convertedQuantity: documentLines.convertedQuantity,
        lineNo: documentLines.lineNo,
      })
      .from(documentLines)
      .leftJoin(items, eq(items.id, documentLines.itemId))
      .leftJoin(units, eq(units.id, documentLines.unitId))
      .where(eq(documentLines.documentId, documentId))
      .orderBy(documentLines.lineNo),
  ]);
  if (!doc) return null;

  const quoted = lineRows.reduce((sum, l) => sum + Number(l.quantity), 0);
  const converted = lineRows.reduce((sum, l) => sum + Number(l.convertedQuantity ?? 0), 0);

  return {
    id: doc.id,
    number: doc.number,
    companyId: doc.companyId,
    contactId: doc.contactId ?? "",
    documentDate: doc.documentDate,
    validUntil: doc.validUntil ?? "",
    discountTotal: doc.discountTotal,
    taxTotal: doc.taxTotal,
    shippingTotal: doc.shippingTotal,
    grandTotal: doc.grandTotal,
    status: statusOf(quoted, converted, doc.validUntil),
    lines: lineRows.map(
      (l): QuotationLine => ({
        itemId: l.itemId ?? "",
        itemName: l.itemName ?? "",
        unitId: l.unitId ?? "",
        unitName: l.unitName ?? "",
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        convertedQuantity: l.convertedQuantity ?? "0",
      }),
    ),
  };
}

type LineInput = { itemId: string; itemName: string; unitId: string; unitName: string; quantity: string; unitPrice: string };

function readForm(formData: FormData) {
  const companyId = String(formData.get("companyId") ?? "");
  const documentDate = String(formData.get("documentDate") ?? "");
  const validUntil = String(formData.get("validUntil") ?? "").trim() || null;
  const contactId = String(formData.get("contactId") ?? "").trim() || null;
  const contactName = String(formData.get("contactName") ?? "").trim() || null;
  const discountTotal = String(formData.get("discountTotal") ?? "0") || "0";
  const taxTotal = String(formData.get("taxTotal") ?? "0") || "0";
  const shippingTotal = String(formData.get("shippingTotal") ?? "0") || "0";

  let lines: LineInput[] = [];
  try {
    const parsed = JSON.parse(String(formData.get("linesJson") ?? "[]"));
    if (Array.isArray(parsed)) lines = parsed;
  } catch {
    // A malformed payload is an empty quotation, which the check below rejects
    // with a sentence rather than a crash.
  }
  const validLines = lines.filter((l) => (l.itemId || l.itemName?.trim()) && Number(l.quantity) > 0);

  const financialError = financialDocumentError(validLines, [
    { label: "Discount", value: discountTotal },
    { label: "Tax", value: taxTotal },
    { label: "Shipping", value: shippingTotal },
  ]);

  const subtotal = round1(validLines.reduce((sum, l) => sum + Number(l.quantity) * (Number(l.unitPrice) || 0), 0));
  const grandTotal = round1(subtotal - Number(discountTotal) + Number(taxTotal) + Number(shippingTotal));

  const error = !companyId
    ? "Company is required."
    : !documentDate
      ? "Quotation date is required."
      : !contactId && !contactName
        ? "Customer is required."
        : validLines.length === 0
          ? "Add at least one item."
          : financialError
            ? financialError
          : // A quotation that expired before it was written helps nobody, and is
            // almost always a mistyped year.
            validUntil && validUntil < documentDate
            ? "Valid Until can't be before the quotation date."
            : null;

  return { companyId, documentDate, validUntil, contactId, contactName, discountTotal, taxTotal, shippingTotal, validLines, subtotal, grandTotal, error };
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function writeLines(tx: Tx, companyId: string, documentId: string, lines: LineInput[]) {
  const itemIds = await resolveItemIds(tx, lines.map((line) => ({ companyId, itemId: line.itemId || null, itemName: line.itemName || null })));
  const unitIds = await resolveUnitIds(tx, lines.map((line) => ({ unitId: line.unitId || null, unitName: line.unitName || null })));
  const rows = lines.map((l, i) => {
    const quantity = Number(l.quantity);
    const unitPrice = Number(l.unitPrice) || 0;
    return {
      companyId,
      documentId,
      lineNo: i + 1,
      sortOrder: i,
      // A name typed over the dropdown creates the record, the same rule the
      // sale and purchase grids follow.
      itemId: itemIds[i] ?? null,
      unitId: unitIds[i] ?? null,
      quantity: String(quantity),
      baseQuantity: String(quantity),
      unitPrice: String(unitPrice),
      lineTotal: String(round1(quantity * unitPrice)),
      convertedQuantity: "0",
    };
  });
  if (rows.length > 0) await tx.insert(documentLines).values(rows);
}

export async function createQuotation(_prevState: (ActionResult & { id?: string }) | undefined, formData: FormData): Promise<ActionResult & { id?: string }> {
  return guard(
    "Couldn't save the quotation.",
    async () => {
      const session = await getLiveSession();

      const f = readForm(formData);
      if (f.error) return { error: f.error };
      // Scoped to the submitted company — the user must both belong to it and
      // hold quotations.create THERE. A queued submission was filled against
      // the offline cache, which can list a company access or permission was
      // revoked from since; the cache prepares work, it never grants it. A
      // permission held in some other company, or an access revoked since the
      // form was filled, is refused here rather than written into.
      requirePermission(session, "quotations", "create", { companyId: f.companyId });
      const operationId = readOperationId(formData);

      const documentType = await quotationType(f.companyId);

      let createdNumber = "";
      const createdId = await db.transaction(async (tx) => {
        // First statement: claim the operation id, or abort as a duplicate.
        if (!(await claimOperation(tx, operationId))) throw new DuplicateOperationError();
        // Allocated inside the transaction so a failure gives the number back.
        const number = await nextDocumentNumber(documentType.series, tx);
        createdNumber = number;
        const contactId = await resolveContactId(tx, f.companyId, f.contactId, f.contactName);
        const [doc] = await tx
          .insert(documents)
          .values({
            companyId: f.companyId,
            documentTypeId: documentType.id,
            number,
            // Quotations sit at "pending" rather than "posted": nothing has been
            // posted anywhere, which is exactly what makes it a quotation.
            status: "pending",
            documentDate: f.documentDate,
            validUntil: f.validUntil,
            contactId,
            subtotal: String(f.subtotal),
            discountTotal: f.discountTotal,
            taxTotal: f.taxTotal,
            shippingTotal: f.shippingTotal,
            grandTotal: String(f.grandTotal),
            createdBy: session.userId,
          })
          .returning({ id: documents.id });

        await tx.insert(documentNumberLedger).values({ companyId: f.companyId, documentTypeId: documentType.id, number, documentId: doc.id });
        await writeLines(tx, f.companyId, doc.id, f.validLines);
        return doc.id;
      });

      // A quotation can create items, units and contacts on the fly, so their
      // cached option lists are stale.
      invalidateLookups(CACHE.documentTypes, CACHE.items, CACHE.units, CACHE.contacts, CACHE.cheques);
      revalidatePath("/sales/quotations");
      await recordAudit({
        action: "create",
        entity: "quotation",
        entityId: createdId,
        summary: createdNumber,
        companyId: f.companyId,
        detail: `Total ${f.grandTotal}`,
      });
      return { success: true, id: createdId };
    },
    { [DUPLICATE]: "Can't create — that quotation number is already in use for this company." },
  );
}

export async function updateQuotation(documentId: string, _prevState: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard("Couldn't save the quotation.", async () => {
    const session = await getLiveSession();

    const f = readForm(formData);
    if (f.error) return { error: f.error };
    // Scoped to the submitted company: membership and per-company permission,
    // so a forged or stale companyId can't steer an edit into (or out of) a set
    // of books the user can't act on.
    requirePermission(session, "quotations", "edit", { companyId: f.companyId });

    const [existing] = await db
      .select({ number: documents.number, companyId: documents.companyId })
      .from(documents)
      .innerJoin(documentTypes, eq(documentTypes.id, documents.documentTypeId))
      .where(and(eq(documents.id, documentId), eq(documentTypes.code, "QUOTATION"), await companyInScope(documents.companyId)))
      .limit(1);
    if (!existing) return { error: "Quotation not found." };
    if (existing.companyId !== f.companyId) return { error: "A quotation can't be moved to another company. Delete it and enter it in the correct company." };

    // Refused rather than silently dropping the converted quantities: the lines
    // are being replaced wholesale below, and rewriting a quotation that already
    // has an invoice behind it would make the two disagree about what was sold.
    const [{ converted }] = await db
      .select({ converted: sql<string>`coalesce(sum(${documentLines.convertedQuantity}), 0)` })
      .from(documentLines)
      .where(eq(documentLines.documentId, documentId));
    if (Number(converted) > 0) {
      return { error: "Part of this quotation has already been invoiced, so it can't be edited. Raise a new quotation for the rest." };
    }

    await db.transaction(async (tx) => {
      await tx
        .update(documents)
        .set({
          companyId: f.companyId,
          documentDate: f.documentDate,
          validUntil: f.validUntil,
          contactId: await resolveContactId(tx, f.companyId, f.contactId, f.contactName),
          subtotal: String(f.subtotal),
          discountTotal: f.discountTotal,
          taxTotal: f.taxTotal,
          shippingTotal: f.shippingTotal,
          grandTotal: String(f.grandTotal),
          updatedAt: new Date(),
        })
        .where(eq(documents.id, documentId));

      // No inventory_transactions to clear first — a quotation never wrote any.
      await tx.delete(documentLines).where(eq(documentLines.documentId, documentId));
      await writeLines(tx, f.companyId, documentId, f.validLines);
    });

    invalidateLookups(CACHE.documentTypes, CACHE.items, CACHE.units, CACHE.contacts, CACHE.cheques);
    revalidatePath("/sales/quotations");
    await recordAudit({ action: "update", entity: "quotation", entityId: documentId, summary: existing.number, companyId: f.companyId, detail: `Total ${f.grandTotal}` });
    return { success: true };
  });
}

export async function deleteQuotation(_prevState: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard("Can't delete — this quotation is still referenced elsewhere.", async () => {
    const session = await getLiveSession();
    requirePermission(session, "quotations", "delete");

    const documentId = String(formData.get("documentId") ?? "");
    const [doomed] = await db
      .select({ number: documents.number, companyId: documents.companyId })
      .from(documents)
      .innerJoin(documentTypes, eq(documentTypes.id, documents.documentTypeId))
      .where(and(eq(documents.id, documentId), eq(documentTypes.code, "QUOTATION"), await companyInScope(documents.companyId)))
      .limit(1);
    if (!doomed) return { error: "Quotation not found." };
    // The delete permission is checked against the row's own company — a
    // guessed id from a company the user can't delete in is refused even when
    // they hold the permission somewhere else.
    requirePermission(session, "quotations", "delete", { companyId: doomed.companyId });

    // The invoices raised from it keep their own lines and stock; they just stop
    // pointing back (source_document_id is ON DELETE SET NULL).
    await db.transaction(async (tx) => {
      await tx.delete(documentLines).where(eq(documentLines.documentId, documentId));
      await tx.delete(documents).where(eq(documents.id, documentId));
    });

    invalidateLookups(CACHE.cheques);
    revalidatePath("/sales/quotations");
    await recordAudit({ action: "delete", entity: "quotation", entityId: documentId, summary: doomed.number, companyId: doomed.companyId });
    return { success: true };
  });
}

// --- Conversion ------------------------------------------------------------

// Turning quoted lines into a real invoice. `quantities` is what to convert per
// line index — the form offers the remaining amount and lets it be reduced, which
// is what makes "half now, half later" work.
//
// The invoice itself is made by createSale rather than reimplemented here. That
// is the only function in this app that knows how a sale is posted — the stock
// movements, the receivable, the settlement, the numbering — and a second
// half-copy of it would drift the first time any of that changed.
export async function convertQuotation(
  documentId: string,
  _prevState: (ActionResult & { invoiceId?: string }) | undefined,
  formData: FormData,
): Promise<ActionResult & { invoiceId?: string }> {
  return guard("Couldn't convert the quotation.", async () => {
    const session = await getLiveSession();

    const quotation = await getQuotation(documentId);
    if (!quotation) return { error: "Quotation not found." };
    // Both sides scoped to the quotation's company: editing the quotation (the
    // converted quantities are written below) and raising the invoice from it
    // both require the permission in THAT company, not merely somewhere.
    requirePermission(session, "quotations", "edit", { companyId: quotation.companyId });
    requirePermission(session, "sales", "create", { companyId: quotation.companyId });

    let requested: Record<number, string> = {};
    try {
      const parsed = JSON.parse(String(formData.get("quantitiesJson") ?? "{}"));
      if (parsed && typeof parsed === "object") requested = parsed;
    } catch {
      return { error: "Nothing to convert." };
    }

    // Every line is checked before any invoice is raised: an invoice for four of
    // the five lines, refused on the fifth, is the outcome nobody can unpick.
    const converting: { index: number; quantity: number }[] = [];
    for (const [key, raw] of Object.entries(requested)) {
      const index = Number(key);
      const line = quotation.lines[index];
      if (!line) continue;
      const quantity = Number(raw);
      if (!Number.isFinite(quantity) || quantity <= 0) continue;
      const remaining = Number(line.quantity) - Number(line.convertedQuantity);
      if (quantity > remaining + 1e-9) {
        return { error: `Line ${index + 1}: only ${remaining} left to convert on this quotation.` };
      }
      converting.push({ index, quantity });
    }
    if (converting.length === 0) return { error: "Pick at least one line, with a quantity above zero." };

    // The invoice is raised through the ordinary sale path, so it moves stock,
    // books the receivable and takes its number exactly like a counter sale.
    const saleForm = new FormData();
    saleForm.set("companyId", quotation.companyId);
    saleForm.set("documentDate", String(formData.get("documentDate") ?? todayISO()));
    saleForm.set("contactId", quotation.contactId);
    saleForm.set("contactName", "");
    // The quoted rate is the promise being kept, so it carries over untouched.
    saleForm.set(
      "linesJson",
      JSON.stringify(
        converting.map(({ index, quantity }) => ({
          itemId: quotation.lines[index].itemId,
          itemName: "",
          unitId: quotation.lines[index].unitId,
          unitName: "",
          quantity: String(quantity),
          unitPrice: quotation.lines[index].unitPrice,
          unitCost: "",
        })),
      ),
    );
    // Header adjustments belong to the whole quotation and can't be split across
    // partial conversions without inventing a rule nobody asked for. A full
    // conversion carries them; a partial one leaves them for the last invoice.
    const whole = converting.length === quotation.lines.length && converting.every(({ index, quantity }) => quantity >= Number(quotation.lines[index].quantity) - Number(quotation.lines[index].convertedQuantity));
    saleForm.set("discountTotal", whole ? quotation.discountTotal : "0");
    saleForm.set("taxTotal", whole ? quotation.taxTotal : "0");
    saleForm.set("shippingTotal", whole ? quotation.shippingTotal : "0");
    // Unpaid: a converted quotation is an invoice raised, not money taken. It is
    // settled from the invoice list like any other.
    saleForm.set("isPaid", "no");

    const sale = await createSale(undefined, saleForm);
    if (sale.error || !sale.id) return { error: sale.error ?? "The invoice wasn't created." };

    // Only now is the quotation marked off — if the invoice had failed, nothing
    // above this line changed, and the same conversion can simply be retried.
    await db.transaction(async (tx) => {
      await tx.update(documents).set({ sourceDocumentId: documentId }).where(eq(documents.id, sale.id!));
      const values = sql.join(converting.map(({ index, quantity }) => sql`(${index + 1}::int, ${String(quantity)}::numeric)`), sql`, `);
      await tx.execute(sql`
        UPDATE document_lines dl
        SET converted_quantity = coalesce(dl.converted_quantity, 0) + v.quantity
        FROM (VALUES ${values}) AS v(line_no, quantity)
        WHERE dl.document_id = ${documentId}
          AND dl.line_no = v.line_no
      `);
    });

    revalidatePath("/sales/quotations");
    revalidatePath(`/sales/quotations/${documentId}`);
    revalidatePath("/sales/invoices");
    await recordAudit({
      action: "update",
      entity: "quotation",
      entityId: documentId,
      summary: quotation.number,
      companyId: quotation.companyId,
      detail: `Converted ${converting.length} line(s) to an invoice`,
    });
    return { success: true, invoiceId: sale.id };
  });
}

// The invoices a quotation has already produced — the conversion history panel.
export async function conversionsOf(documentId: string) {
  const session = await getSession();
  requirePermission(session, "quotations", "view");

  return db
    .select({
      id: documents.id,
      number: documents.number,
      documentDate: documents.documentDate,
      grandTotal: documents.grandTotal,
    })
    .from(documents)
    .where(and(eq(documents.sourceDocumentId, documentId), await companyInScope(documents.companyId)))
    .orderBy(documents.documentDate);
}

// Used by the delete guard on a customer/company: which quotations point here.
export async function quotationsForDocuments(ids: string[]) {
  if (ids.length === 0) return [];
  return db.select({ id: documents.id }).from(documents).where(inArray(documents.sourceDocumentId, ids));
}
