"use server";

import { and, desc, eq, isNull, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { contacts, whatsappMessages } from "@/lib/db/schema";
import { getLiveSession, getSession, type AuthSession } from "@/lib/auth/session";
import { requirePermission } from "@/lib/auth/permissions";
import { companyInPermissionScope } from "@/lib/auth/scope";
import { guard, type ActionResult } from "@/lib/actions/guard";
import { recordAudit } from "@/lib/actions/audit";

// A handoff deliberately is not a provider send. The browser opens the user's
// own WhatsApp with this URL, and only their final tap actually sends anything.
function waMeLink(phone: string, body: string) {
  return `https://wa.me/${phone}?text=${encodeURIComponent(body)}`;
}

function normalizedPhone(value: string): string | null {
  const phone = value.replace(/\D/g, "");
  return phone.length >= 8 && phone.length <= 20 ? phone : null;
}

function requireContactView(session: AuthSession | null, companyId?: string): asserts session is AuthSession {
  const scope = companyId ? { companyId } : undefined;
  try {
    requirePermission(session, "customers", "view", scope);
  } catch {
    requirePermission(session, "suppliers", "view", scope);
  }
}

export type WhatsAppRecipient = { id: string; companyId: string | null; name: string; phone: string | null };

export async function listWhatsAppRecipients(): Promise<WhatsAppRecipient[]> {
  const session = await getSession();
  requireContactView(session);
  const [customerScope, supplierScope] = await Promise.all([
    companyInPermissionScope(contacts.companyId, session, "customers"),
    companyInPermissionScope(contacts.companyId, session, "suppliers"),
  ]);
  return db
    .select({ id: contacts.id, companyId: contacts.companyId, name: contacts.displayName, phone: contacts.phone })
    .from(contacts)
    .where(and(eq(contacts.isActive, true), or(customerScope, supplierScope)))
    .orderBy(contacts.displayName);
}

export type WhatsAppMessageRow = {
  id: string;
  createdAt: Date;
  recipientName: string;
  phone: string;
  body: string;
  status: "handoff" | "queued" | "sent" | "delivered" | "read" | "failed";
  error: string | null;
};

export async function listWhatsAppMessages(): Promise<WhatsAppMessageRow[]> {
  const session = await getSession();
  requireContactView(session);
  const [customerScope, supplierScope] = await Promise.all([
    companyInPermissionScope(whatsappMessages.companyId, session, "customers"),
    companyInPermissionScope(whatsappMessages.companyId, session, "suppliers"),
  ]);
  return db
    .select({
      id: whatsappMessages.id,
      createdAt: whatsappMessages.createdAt,
      recipientName: whatsappMessages.recipientName,
      phone: whatsappMessages.phone,
      body: whatsappMessages.body,
      status: whatsappMessages.status,
      error: whatsappMessages.error,
    })
    .from(whatsappMessages)
    .where(or(customerScope, supplierScope))
    .orderBy(desc(whatsappMessages.createdAt))
    .limit(100);
}

export async function createWhatsAppHandoff(
  _prevState: (ActionResult & { url?: string }) | undefined,
  formData: FormData,
): Promise<ActionResult & { url?: string }> {
  return guard("Couldn't prepare the WhatsApp message.", async () => {
    const session = await getLiveSession();
    const companyId = String(formData.get("companyId") ?? "").trim();
    const contactId = String(formData.get("contactId") ?? "").trim();
    const body = String(formData.get("body") ?? "").trim();
    if (!companyId) return { error: "Choose the company this message belongs to." };
    if (!contactId) return { error: "Choose a contact." };
    if (!body) return { error: "Write a message first." };
    if (body.length > 4_000) return { error: "Keep the message under 4,000 characters." };
    requireContactView(session, companyId);

    const [contact] = await db
      .select({ id: contacts.id, name: contacts.displayName, phone: contacts.phone })
      .from(contacts)
      .where(and(eq(contacts.id, contactId), or(eq(contacts.companyId, companyId), isNull(contacts.companyId))))
      .limit(1);
    if (!contact) return { error: "That contact is not available to this company." };
    const phone = normalizedPhone(contact.phone ?? "");
    if (!phone) return { error: "This contact needs a full WhatsApp number, including country code." };

    const [message] = await db
      .insert(whatsappMessages)
      .values({ companyId, contactId: contact.id, recipientName: contact.name, phone, template: "freeform", body, status: "handoff" })
      .returning({ id: whatsappMessages.id });

    await recordAudit({
      action: "create",
      entity: "whatsapp handoff",
      entityId: message.id,
      summary: contact.name,
      companyId,
      detail: "Opened in the user's WhatsApp; sending is completed outside the ERP.",
    });
    return { success: true, url: waMeLink(phone, body) };
  });
}
