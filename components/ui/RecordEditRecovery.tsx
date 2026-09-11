"use client";
import { useRef, useState, type ReactNode } from "react";
import { clearDraft, readDraft, saveDraft } from "@/lib/draft";
import { getClientUserId } from "@/lib/client-user";
import { isRecordDraft, recordFields, restoreRecordFields, type RecordDraft } from "@/lib/record-recovery";

// Used by the five plain master editors, whose controls are native and
// uncontrolled. Complex document editors keep their own state-aware recovery.
export function RecordEditRecovery({ domain, record, children }: {
  domain: string; record: { id: string; _revision?: string }; children: ReactNode;
}) {
  const key = `edit:${getClientUserId()}:${domain}:${record.id}`;
  const root = useRef<HTMLDivElement>(null);
  const restoring = useRef(false);
  const [saved, setSaved] = useState(() => readDraft<RecordDraft>(key));
  const [error, setError] = useState(false);
  const revision = record._revision;
  const changed = !!saved && (!isRecordDraft(saved) || saved.revision !== revision);
  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(saved, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `unsaved-${domain}-${record.id}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <div ref={root} className="flex flex-col gap-4" data-command-table={domain} data-command-record={record.id} data-command-revision={revision} data-recovery-key={key}
    onInput={event => {
      if (restoring.current || saved || !revision || !(event.target instanceof HTMLElement)) return;
      const form = event.target.closest("form");
      if (form) setError(!saveDraft(key, { revision, fields: recordFields(form) } satisfies RecordDraft));
    }}>
    {saved && <div className="mb-3 rounded border border-brass-600 bg-brass-100 p-3 text-sm">
      <p>{changed ? "This record changed since your unsaved edit. Download your previous input to review it against the latest record." : "You have an unsaved edit from earlier. Restore or discard it before continuing."}</p>
      <div className="mt-2 flex gap-3">
        {!changed && <button type="button" onClick={() => {
          const form = root.current?.querySelector("form");
          if (!form) return;
          restoring.current = true;
          restoreRecordFields(form, saved.fields);
          restoring.current = false;
          setSaved(null);
        }}>Restore edit</button>}
        <button type="button" onClick={download}>Download a copy</button>
        <button type="button" onClick={() => { clearDraft(key); setSaved(null); }}>Discard edit</button>
      </div>
    </div>}
    {!revision && <p role="alert" className="mb-2 text-sm text-error">Refresh this page to load the record version before editing.</p>}
    {error && <p role="alert" className="mb-2 text-sm text-error">This browser could not preserve your edit. Keep this form open until it is saved.</p>}
    <fieldset disabled={!!saved || !revision} className="contents">{children}</fieldset>
  </div>;
}
