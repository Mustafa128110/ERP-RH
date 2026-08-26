"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { createWhatsAppHandoff, type WhatsAppMessageRow, type WhatsAppRecipient } from "@/lib/actions/whatsapp";
import type { ComboOption } from "@/components/ui/ComboBox";

export function WhatsAppHandoff({ recipients, companies, messages }: { recipients: WhatsAppRecipient[]; companies: ComboOption[]; messages: WhatsAppMessageRow[] }) {
  const [state, action, pending] = useActionState(createWhatsAppHandoff, {});
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? "");
  const [contactId, setContactId] = useState("");
  const availableContacts = useMemo(() => recipients.filter((contact) => !contact.companyId || contact.companyId === companyId), [companyId, recipients]);

  useEffect(() => {
    // A navigation (unlike a late window.open after a Server Action round trip)
    // is not subject to a popup blocker. The browser back button returns to the
    // ERP after the user has sent or dismissed WhatsApp's compose screen.
    if (state.url) window.location.assign(state.url);
  }, [state.url]);

  return (
    <div className="flex flex-col gap-5">
      <form action={action} className="rounded-lg border border-sand bg-white p-5">
        <h2 className="text-sm font-semibold text-navy-800">Open a WhatsApp message</h2>
        <p className="mt-1 text-sm text-steel">The message opens in your own WhatsApp. It is logged as a handoff, not a confirmed send.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-sm text-ink">Company
            <select name="companyId" value={companyId} onChange={(event) => { setCompanyId(event.target.value); setContactId(""); }} className="mt-1 w-full rounded border border-sand bg-white px-3 py-2">
              <option value="">Choose company</option>
              {companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
            </select>
          </label>
          <label className="text-sm text-ink">Contact
            <select name="contactId" value={contactId} onChange={(event) => setContactId(event.target.value)} className="mt-1 w-full rounded border border-sand bg-white px-3 py-2">
              <option value="">Choose contact</option>
              {availableContacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.name}{contact.phone ? ` · ${contact.phone}` : " · no phone"}</option>)}
            </select>
          </label>
        </div>
        <label className="mt-3 block text-sm text-ink">Message
          <textarea name="body" required rows={5} maxLength={4000} className="mt-1 w-full rounded border border-sand bg-white px-3 py-2" placeholder="Write the message to open in WhatsApp…" />
        </label>
        {state.error && <p className="mt-3 rounded border border-error/30 bg-error-tint p-3 text-sm text-error">{state.error}</p>}
        <button type="submit" disabled={pending} className="mt-4 rounded bg-navy-800 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">{pending ? "Preparing…" : "Open WhatsApp"}</button>
      </form>
      <div className="rounded-lg border border-sand bg-white p-5">
        <h2 className="text-sm font-semibold text-navy-800">Recent message handoffs</h2>
        {messages.length === 0 ? <p className="mt-2 text-sm text-steel">No messages logged yet.</p> : <ul className="mt-3 divide-y divide-sand">{messages.map((message) => <li key={message.id} className="py-3 text-sm"><div className="flex flex-wrap justify-between gap-x-3 gap-y-1"><span className="font-medium text-ink">{message.recipientName}</span><span className="text-steel">{message.status}</span></div><p className="mt-1 whitespace-pre-wrap text-steel">{message.body}</p></li>)}</ul>}
      </div>
    </div>
  );
}
