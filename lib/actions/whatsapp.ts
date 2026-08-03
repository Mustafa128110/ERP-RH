"use server";

import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { companies, contacts, documents, whatsappMessages } from "@/lib/db/schema";
import { getSession } from "@/lib/auth/session";
import { requirePermission } from "@/lib/auth/permissions";
import { companyInScope } from "@/lib/auth/scope";
import { guard, type ActionResult } from "@/lib/actions/guard";
import { recordAudit } from "@/lib/actions/audit";
import { isConfigured, sendText } from "@/lib/whatsapp";
import { normalizePhone, renderTemplate, waMeLink, type TemplateKey } from "@/lib/whatsapp-templates";

// The row is written before the send is attempted, and updated with what came
// back. That order is the whole design: a message that fails is still in the log
// with the reason, so it can be retried without being retyped — and a crash
// between the two leaves a `queued` row, which is the truth (we don't know) and
// not a lie in either direction.

export type WhatsAppRow = {
  id: string;
  createdAt: Date;
  recipientName: string;
  phone: string;
  template: string;
  status: string;
  body: string;
  error: string | null;
  company: string;
  documentNumber: string | null;
};

const PAGE = 200;

export async function listWhatsAppMessages(): Promise<WhatsAppRow[]> {
  const session = await getSession();
  requirePermission(session, "whatsapp", "view");

  return db
    .select({
      id: whatsappMessages.id,
      createdAt: whatsappMessages.createdAt,
      recipientName: whatsappMessages.recipientName,
      phone: whatsappMessages.phone,
      template: whatsappMessages.template,
      status: whatsappMessages.status,
      body: whatsappMessages.body,
      error: whatsappMessages.error,
      company: companies.name,
      documentNumber: documents.number,
    })
    .from(whatsappMessages)
    .innerJoin(companies, eq(companies.id, whatsappMessages.companyId))
    .leftJoin(documents, eq(documents.id, whatsappMessages.documentId))
    .where(await companyInScope(whatsappMessages.companyId))
    .orderBy(desc(whatsappMessages.createdAt))
    .limit(PAGE);
}

// Whether the page should offer to send at all, and what to say if not.
export async function whatsappStatus(): Promise<{ configured: boolean }> {
  const session = await getSession();
  requirePermission(session, "whatsapp", "view");
  return { configured: isConfigured() };
}

// Contacts with a usable number, for the send dialog's picker. A contact with no
// phone can't be messaged, so offering them is offering a dead end.
export async function whatsappRecipients(): Promise<{ id: string; name: string; phone: string; companyId: string | null }[]> {
  const session = await getSession();
  requirePermission(session, "whatsapp", "view");

  const rows = await db
    .select({ id: contacts.id, name: contacts.displayName, phone: contacts.phone, companyId: contacts.companyId })
    .from(contacts)
    .where(await companyInScope(contacts.companyId))
    .orderBy(contacts.displayName);

  return rows.filter((r): r is typeof r & { phone: string } => Boolean(r.phone && normalizePhone(r.phone)));
}

async function deliver(messageId: string, phone: string, body: string) {
  const result = await sendText(phone, body);
  await db
    .update(whatsappMessages)
    .set(
      result.ok
        ? { status: "sent", providerMessageId: result.providerMessageId, error: null, updatedAt: new Date() }
        : { status: "failed", error: result.error, updatedAt: new Date() },
    )
    .where(eq(whatsappMessages.id, messageId));
  return result;
}

export async function sendWhatsAppMessage(_prevState: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard("Couldn't send the message.", async () => {
    const session = await getSession();
    requirePermission(session, "whatsapp", "create");

    const companyId = String(formData.get("companyId") ?? "");
    const contactId = String(formData.get("contactId") ?? "") || null;
    const recipientName = String(formData.get("recipientName") ?? "").trim();
    const rawPhone = String(formData.get("phone") ?? "").trim();
    const template = String(formData.get("template") ?? "custom") as TemplateKey;
    const documentId = String(formData.get("documentId") ?? "") || null;
    // The body arrives already rendered: the dialog shows exactly what will be
    // sent and lets it be edited, and what was shown is what gets stored.
    const body = String(formData.get("body") ?? "").trim();

    if (!companyId) return { error: "Company is required." };
    if (!recipientName) return { error: "Who is this going to?" };
    if (!body) return { error: "The message is empty." };

    const phone = normalizePhone(rawPhone);
    if (!phone) return { error: `"${rawPhone}" doesn't look like a phone number. Use the local form (0300-1234567) or the full international one.` };

    const [row] = await db
      .insert(whatsappMessages)
      .values({ companyId, contactId, recipientName, phone, template, documentId, body, status: "queued" })
      .returning({ id: whatsappMessages.id });

    const result = await deliver(row.id, phone, body);

    revalidatePath("/whatsapp");
    await recordAudit({
      action: "create",
      entity: "whatsapp message",
      entityId: row.id,
      summary: `${recipientName} · ${template}`,
      companyId,
      detail: result.ok ? "Sent" : `Failed: ${result.error}`,
    });

    // Not an error return: the message is saved either way, and the log is where
    // it gets retried from. Saying "couldn't send, it's in the log" is the honest
    // outcome — pretending it went is not.
    return result.ok ? { success: true } : { error: result.error };
  });
}

// The free path: log the message, hand back a wa.me link, and let the user's own
// WhatsApp send it.
//
// Costs nothing and carries no ban risk — wa.me is Meta's own documented link
// format and the message is sent from the person's own account, not by a bot.
// That is why it is the default for anything going to a customer: the Cloud API
// bills per business-initiated message and refuses free-form text outside a
// customer's 24-hour window, so an invoice sent to someone who hasn't messaged
// today would either cost money or be rejected outright.
//
// Logged as `handoff` rather than `sent` because that is the truth: the message
// was composed and opened, and whether a finger pressed send is something this
// system genuinely cannot know.
export async function handoffWhatsAppMessage(
  _prevState: (ActionResult & { link?: string }) | undefined,
  formData: FormData,
): Promise<ActionResult & { link?: string }> {
  return guard("Couldn't prepare the message.", async () => {
    const session = await getSession();
    requirePermission(session, "whatsapp", "create");

    const companyId = String(formData.get("companyId") ?? "");
    const contactId = String(formData.get("contactId") ?? "") || null;
    const recipientName = String(formData.get("recipientName") ?? "").trim();
    const rawPhone = String(formData.get("phone") ?? "").trim();
    const template = String(formData.get("template") ?? "custom") as TemplateKey;
    const documentId = String(formData.get("documentId") ?? "") || null;
    const body = String(formData.get("body") ?? "").trim();

    if (!companyId) return { error: "Company is required." };
    if (!recipientName) return { error: "Who is this going to?" };
    if (!body) return { error: "The message is empty." };

    const phone = normalizePhone(rawPhone);
    const link = waMeLink(rawPhone, body);
    if (!phone || !link) {
      return { error: `"${rawPhone}" doesn't look like a phone number. Use the local form (0300-1234567) or the full international one.` };
    }

    const [row] = await db
      .insert(whatsappMessages)
      .values({ companyId, contactId, recipientName, phone, template, documentId, body, status: "handoff" })
      .returning({ id: whatsappMessages.id });

    revalidatePath("/whatsapp");
    await recordAudit({
      action: "create",
      entity: "whatsapp message",
      entityId: row.id,
      summary: `${recipientName} · ${template}`,
      companyId,
      detail: "Opened in WhatsApp to send by hand",
    });

    return { success: true, link };
  });
}

// Retries a failed row exactly as it was written. The body is not re-rendered
// from the template — what was approved is what goes out.
export async function retryWhatsAppMessage(_prevState: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard("Couldn't resend the message.", async () => {
    const session = await getSession();
    requirePermission(session, "whatsapp", "create");

    const messageId = String(formData.get("messageId") ?? "");
    const [row] = await db
      .select({ id: whatsappMessages.id, phone: whatsappMessages.phone, body: whatsappMessages.body, status: whatsappMessages.status })
      .from(whatsappMessages)
      .where(and(eq(whatsappMessages.id, messageId), await companyInScope(whatsappMessages.companyId)))
      .limit(1);
    if (!row) return { error: "Message not found." };
    if (row.status === "sent" || row.status === "delivered" || row.status === "read") {
      return { error: "That message already went — resending would send it twice." };
    }

    const result = await deliver(row.id, row.phone, row.body);
    revalidatePath("/whatsapp");
    return result.ok ? { success: true } : { error: result.error };
  });
}

// Renders a template server-side so the send dialog can preview exactly what
// will go out. Kept here rather than in the browser because the wording is a
// business rule, and one copy of it is the point.
export async function previewWhatsAppMessage(
  template: TemplateKey,
  input: { companyName: string; recipientName: string; documentNumber?: string; amount?: string; balance?: string; date?: string; validUntil?: string; body?: string },
): Promise<string> {
  const session = await getSession();
  requirePermission(session, "whatsapp", "view");
  return renderTemplate(template, input);
}
