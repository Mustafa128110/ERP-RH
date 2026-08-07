"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useNewEntry } from "@/components/layout/KeyboardShortcuts";
import { handoffWhatsAppMessage, retryWhatsAppMessage, sendWhatsAppMessage, type WhatsAppRow } from "@/lib/actions/whatsapp";
import { DataTable } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { Dialog } from "@/components/ui/Dialog";
import { DetailHover } from "@/components/ui/DetailHover";
import { ComboBox } from "@/components/ui/ComboBox";
import { errorTextClass, inputClass, labelClass, labelTextClass, primaryActionClass, secondaryActionClass } from "@/components/ui/form-styles";
import { renderTemplate, TEMPLATE_LABELS, waMeLink, type TemplateKey } from "@/lib/whatsapp-templates";
import { statusColumn, type ColumnDef, type Row } from "@/lib/table";

type Recipient = { id: string; name: string; phone: string; companyId: string | null };
type Company = { id: string; name: string };

function when(value: Date): string {
  const d = new Date(value);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const columns: ColumnDef[] = [
  { key: "when", label: "When" },
  { key: "recipient", label: "Recipient" },
  { key: "phone", label: "Number" },
  { key: "template", label: "Template" },
  { key: "document", label: "Document" },
  {
    key: "preview",
    label: "Message",
    // The message body is the thing worth reading and never fits a column.
    render: (row) => (
      <DetailHover
        trigger={String(row.preview)}
        width={360}
        // The body is free text of unknown length; this is the height budget for
        // a message that runs to a screenful.
        extraHeight={140}
        footer={row.error ? String(row.error) : undefined}
      >
        <span className="block whitespace-pre-line text-sm text-ink">{String(row.body)}</span>
      </DetailHover>
    ),
  },
  statusColumn(),
];

export function WhatsAppManager({
  messages,
  configured,
  companies,
  recipients,
}: {
  messages: WhatsAppRow[];
  configured: boolean;
  companies: Company[];
  recipients: Recipient[];
}) {
  const router = useRouter();
  const [composing, setComposing] = useState(false);
  const [retrying, setRetrying] = useState<WhatsAppRow | null>(null);

  const rows: Row[] = messages.map((m) => ({
    id: m.id,
    when: when(m.createdAt),
    recipient: m.recipientName,
    phone: m.phone,
    template: TEMPLATE_LABELS[m.template as TemplateKey] ?? m.template,
    document: m.documentNumber ?? "—",
    // First line only: enough to recognise the message, the rest is on hover.
    preview: m.body.split("\n").find((l) => l.trim()) ?? "(empty)",
    body: m.body,
    error: m.error,
    status: m.status,
  }));

  useNewEntry(() => setComposing(true));

  return (
    <div className="flex h-full flex-col gap-2">
      <PageHeader title="WhatsApp" subtitle={`${messages.length} message(s) — newest first`}>
        <button type="button" onClick={() => setComposing(true)} className={primaryActionClass}>
          + Send Message
        </button>
      </PageHeader>

      {!configured && (
        <div className="shrink-0 rounded border border-sand bg-ivory p-3 text-sm text-ink">
          <p className="font-semibold">Messages open in your own WhatsApp.</p>
          <p className="mt-1">
            Composing and logging work as normal — the message opens in WhatsApp Web or Desktop with the text ready, and you press send. Free, and nothing to
            set up. To send straight from the server instead, set <code className="rounded bg-white px-1">WHATSAPP_PHONE_NUMBER_ID</code> and{" "}
            <code className="rounded bg-white px-1">WHATSAPP_ACCESS_TOKEN</code> in <code className="rounded bg-white px-1">.env</code>; Meta bills per message
            for that.
          </p>
        </div>
      )}

      {/* Clicking a failed row offers to send it again; a sent one has nothing to
          do, and resending it would send it twice. */}
      <DataTable
        columns={columns}
        rows={rows}
        idKey="id"
        onRowClick={(row) => {
          const message = messages.find((m) => m.id === String(row.id));
          if (message && message.status === "failed") setRetrying(message);
        }}
        emptyMessage="Nothing sent yet."
        searchPlaceholder="Search messages…"
      />

      {composing && (
        <ComposeDialog
          companies={companies}
          recipients={recipients}
          providerConfigured={configured}
          onClose={() => setComposing(false)}
          onSent={() => {
            setComposing(false);
            router.refresh();
          }}
        />
      )}

      {retrying && <RetryDialog message={retrying} onClose={() => setRetrying(null)} onDone={() => { setRetrying(null); router.refresh(); }} />}
    </div>
  );
}

function ComposeDialog({
  companies,
  recipients,
  providerConfigured,
  onClose,
  onSent,
}: {
  companies: Company[];
  recipients: Recipient[];
  providerConfigured: boolean;
  onClose: () => void;
  onSent: () => void;
}) {
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? "");
  const [recipientText, setRecipientText] = useState("");
  const [phone, setPhone] = useState("");
  const [template, setTemplate] = useState<TemplateKey>("custom");
  const [body, setBody] = useState("");
  // Set once a template fills the box, so switching template re-fills it but
  // typing over the text is never overwritten underneath the cursor.
  const [edited, setEdited] = useState(false);
  const [state, action, pending] = useActionState(sendWhatsAppMessage, undefined);

  useEffect(() => {
    if (state?.success) onSent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.success]);

  const inScope = recipients.filter((r) => !r.companyId || r.companyId === companyId);
  const picked = inScope.find((r) => r.name === recipientText);
  const companyName = companies.find((c) => c.id === companyId)?.name ?? "";

  // The preview is rendered here rather than fetched, because it is a pure
  // function of what is on screen (lib/whatsapp-templates.ts) — a round trip per
  // keystroke to learn what we already know would be slower and no more correct.
  const rendered = useMemo(
    () => renderTemplate(template, { companyName, recipientName: recipientText || "there", body }),
    [template, companyName, recipientText, body],
  );

  // What actually goes out, and what gets logged — the same string either way.
  const finalBody = template === "custom" ? body : rendered;
  const fields = {
    companyId,
    contactId: picked?.id ?? "",
    recipientName: recipientText,
    phone,
    template,
    body: finalBody,
  };

  // Built in the browser from the same pure helper the server uses, so the
  // button is a real link with a real href — one tap, and no popup blocker,
  // which is what a window.open() after an awaited round trip would hit.
  const link = finalBody.trim() ? waMeLink(phone, finalBody) : null;

  // Logging the hand-off must not delay the tap or block the link, so it is
  // fired alongside the navigation rather than awaited. The action never throws
  // (lib/actions/guard.ts); if the log write fails the message still goes.
  function logHandoff() {
    const formData = new FormData();
    for (const [key, value] of Object.entries(fields)) formData.set(key, value);
    void handoffWhatsAppMessage(undefined, formData);
    onSent();
  }

  function chooseTemplate(next: TemplateKey) {
    setTemplate(next);
    if (next === "custom") return;
    // Templates that reference a document need one picked; from this page the
    // realistic one is the reminder, which needs only the balance. Anything
    // document-shaped is sent from the document itself.
    if (!edited) setBody("");
  }

  return (
    <Dialog
      title="Send WhatsApp Message"
      onClose={onClose}
      footer={
        <div className="flex flex-wrap items-center justify-end gap-3">
          {state?.error && <p className={errorTextClass}>{state.error}</p>}
          <button type="button" onClick={onClose} className={secondaryActionClass}>
            Cancel
          </button>

          {/* Server-side sending bills per message and is refused outside a
              customer's 24-hour window, so it stays the secondary option. */}
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
        {companies.length > 1 && (
          <label className={labelClass}>
            <span className={labelTextClass}>From company</span>
            <select value={companyId} onChange={(e) => setCompanyId(e.target.value)} className={inputClass}>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className={labelClass}>
          <span className={labelTextClass}>To</span>
          <ComboBox
            value={recipientText}
            onChange={(name) => {
              setRecipientText(name);
              // Picking a contact fills their number in; typing a name that
              // matches nobody leaves the number to be typed too.
              const hit = inScope.find((r) => r.name === name);
              if (hit) setPhone(hit.phone);
            }}
            options={inScope}
            placeholder="Pick a contact, or type a name"
            className={`w-full ${inputClass}`}
          />
        </label>

        <label className={labelClass}>
          <span className={labelTextClass}>Number</span>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="0300-1234567"
            inputMode="tel"
            className={inputClass}
          />
        </label>

        <label className={labelClass}>
          <span className={labelTextClass}>Template</span>
          <select value={template} onChange={(e) => chooseTemplate(e.target.value as TemplateKey)} className={inputClass}>
            {(Object.keys(TEMPLATE_LABELS) as TemplateKey[]).map((k) => (
              <option key={k} value={k}>
                {TEMPLATE_LABELS[k]}
              </option>
            ))}
          </select>
        </label>

        <label className={labelClass}>
          <span className={labelTextClass}>{template === "custom" ? "Message" : "Message (preview)"}</span>
          <textarea
            value={template === "custom" ? body : rendered}
            onChange={(e) => {
              setEdited(true);
              setBody(e.target.value);
              // Editing a filled-in template makes it a custom message — what is
              // on screen is what gets sent, and the log records it as typed.
              if (template !== "custom") setTemplate("custom");
            }}
            rows={8}
            className="scroll-thin rounded border border-sand p-3 text-sm text-ink focus:border-navy-800"
          />
        </label>
      </div>
    </Dialog>
  );
}

function RetryDialog({ message, onClose, onDone }: { message: WhatsAppRow; onClose: () => void; onDone: () => void }) {
  const [state, action, pending] = useActionState(retryWhatsAppMessage, undefined);

  useEffect(() => {
    if (state?.success) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.success]);

  return (
    <Dialog
      title="Send again"
      onClose={onClose}
      footer={
        <form action={action} className="flex items-center justify-end gap-3">
          <input type="hidden" name="messageId" value={message.id} />
          {state?.error && <p className={errorTextClass}>{state.error}</p>}
          <button type="button" onClick={onClose} className={secondaryActionClass}>
            Cancel
          </button>
          <button type="submit" disabled={pending} className={primaryActionClass}>
            {pending ? "Sending…" : "Send again"}
          </button>
        </form>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm text-steel">
          To {message.recipientName} on {message.phone}. The message goes out exactly as it was written — nothing is re-rendered.
        </p>
        {message.error && <p className={`rounded border border-error/30 bg-error-tint p-3 ${errorTextClass}`}>Last attempt: {message.error}</p>}
        <p className="whitespace-pre-line rounded border border-sand bg-ivory p-3 text-sm text-ink">{message.body}</p>
      </div>
    </Dialog>
  );
}
