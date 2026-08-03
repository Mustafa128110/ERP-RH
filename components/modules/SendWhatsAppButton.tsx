"use client";

import { useActionState, useEffect, useState } from "react";
import { handoffWhatsAppMessage, sendWhatsAppMessage } from "@/lib/actions/whatsapp";
import { Dialog } from "@/components/ui/Dialog";
import { errorTextClass, inputClass, labelClass, labelTextClass, primaryActionClass, secondaryActionClass } from "@/components/ui/form-styles";
import { renderTemplate, waMeLink, type TemplateInput, type TemplateKey } from "@/lib/whatsapp-templates";

// "Send this document to the customer", from the document itself. That is where
// the sending actually happens in a shop — the WhatsApp page is the log you go
// to afterwards, not the place you start.
//
// The message is rendered here from the same templates the server uses
// (lib/whatsapp-templates.ts is pure and runs on both sides), shown in full, and
// editable before it goes. What is on screen is what gets sent and what gets
// stored: no second rendering pass that could quietly say something else.
export function SendWhatsAppButton({
  companyId,
  template,
  input,
  contactId,
  phone,
  documentId,
  label = "Send on WhatsApp",
  disabledReason,
  providerConfigured = false,
}: {
  companyId: string;
  template: TemplateKey;
  input: TemplateInput;
  contactId?: string | null;
  // The contact's number as stored. Editable in the dialog — a customer often
  // wants it on a different phone from the one on their account.
  phone?: string | null;
  documentId?: string;
  label?: string;
  // Set when there is nothing to send to — in practice, no phone number.
  disabledReason?: string | null;
  // Whether a Cloud API provider is connected. Only decides whether the extra
  // "send from the server" option appears; the free path never needs it.
  providerConfigured?: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={Boolean(disabledReason)}
        title={disabledReason ?? undefined}
        className="flex h-11 items-center rounded border border-sand px-4 text-sm font-medium text-steel hover:bg-ivory disabled:opacity-40 disabled:hover:bg-transparent"
      >
        {label}
      </button>
      {open && (
        <SendDialog
          companyId={companyId}
          template={template}
          input={input}
          contactId={contactId}
          phone={phone}
          documentId={documentId}
          providerConfigured={providerConfigured}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function SendDialog({
  companyId,
  template,
  input,
  contactId,
  phone: initialPhone,
  documentId,
  providerConfigured,
  onClose,
}: {
  companyId: string;
  template: TemplateKey;
  input: TemplateInput;
  contactId?: string | null;
  phone?: string | null;
  documentId?: string;
  providerConfigured: boolean;
  onClose: () => void;
}) {
  const [phone, setPhone] = useState(initialPhone ?? "");
  const [body, setBody] = useState(() => renderTemplate(template, input));
  const [state, action, pending] = useActionState(sendWhatsAppMessage, undefined);

  useEffect(() => {
    if (state?.success) onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.success]);

  // Built in the browser from the same pure helper the server uses, so the
  // button is a real link with a real href — one tap, and no popup blocker,
  // which is what a window.open() after an awaited server round trip would hit.
  const link = waMeLink(phone, body);

  const fields = {
    companyId,
    contactId: contactId ?? "",
    recipientName: input.recipientName,
    phone,
    template,
    documentId: documentId ?? "",
    body,
  };

  // Logging the hand-off must not delay the tap or block the link, so it is
  // fired alongside the navigation rather than awaited. The action never throws
  // (lib/actions/guard.ts); if the log write fails the message still goes.
  function logHandoff() {
    const formData = new FormData();
    for (const [key, value] of Object.entries(fields)) formData.set(key, value);
    void handoffWhatsAppMessage(undefined, formData);
    onClose();
  }

  return (
    <Dialog
      title={`Send ${input.documentNumber ?? "message"} on WhatsApp`}
      onClose={onClose}
      footer={
        <div className="flex flex-wrap items-center justify-end gap-3">
          {state?.error && <p className={errorTextClass}>{state.error}</p>}
          <button type="button" onClick={onClose} className={secondaryActionClass}>
            Cancel
          </button>

          {/* Sending from the server costs money per message and is refused
              outright outside a customer's 24-hour window, so it is the
              secondary option even when a provider is connected. */}
          {providerConfigured && (
            <form action={action}>
              {Object.entries(fields).map(([key, value]) => (
                <input key={key} type="hidden" name={key} value={value} />
              ))}
              <button type="submit" disabled={pending || !link} className={secondaryActionClass}>
                {pending ? "Sending…" : "Send from server"}
              </button>
            </form>
          )}

          <a
            href={link ?? "#"}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => (link ? logHandoff() : e.preventDefault())}
            aria-disabled={!link}
            className={`${primaryActionClass} ${link ? "" : "pointer-events-none opacity-40"}`}
          >
            Open in WhatsApp
          </a>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <label className={labelClass}>
          <span className={labelTextClass}>To {input.recipientName} on</span>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0300-1234567" inputMode="tel" className={inputClass} />
        </label>

        <label className={labelClass}>
          <span className={labelTextClass}>Message</span>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={10}
            className="scroll-thin rounded border border-sand p-3 text-sm text-ink focus:border-navy-800"
          />
        </label>

        {!link && phone.trim() && (
          <p className={errorTextClass}>
            &quot;{phone}&quot; doesn&apos;t look like a phone number. Use the local form (0300-1234567) or the full international one.
          </p>
        )}
      </div>
    </Dialog>
  );
}
