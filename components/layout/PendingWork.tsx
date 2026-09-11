"use client";
import { useState } from "react";
import { useSync } from "./SyncProvider";
import { DataTable } from "@/components/ui/DataTable";
import { Dialog } from "@/components/ui/Dialog";
import { changeCommand } from "@/lib/command-store";
import { getClientUserId } from "@/lib/client-user";
import { COMMAND_LIMIT_BYTES, confirmedArguments, unresolved, type SavedCommand, type CommandValue } from "@/lib/command-protocol";
import { canCancel } from "@/lib/command-sync";
import type { ColumnDef } from "@/lib/table";

const columns: ColumnDef[] = [
  { key: "label", label: "Your saved work" }, { key: "status", label: "Status" }, { key: "message", label: "Details" },
];
function fieldLabel(key: string) { return key.replace(/Json$/, "").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, c => c.toUpperCase()); }
const internal = /^(operationId|confirmAllocations|confirm|confirmed)$/;
function ValueEditor({ value, label, onChange, disabled }: { value: CommandValue; label: string; onChange: (value: CommandValue) => void; disabled: boolean }) {
  if (value === null) return null;
  if (typeof value === "object" && !Array.isArray(value) && Array.isArray(value.$form)) {
    return <div className="space-y-3">{(value.$form as string[][]).map(([key, item], index) => internal.test(key) ? null :
      <ValueEditor key={`${key}:${index}`} label={key} value={item} disabled={disabled || /Id$/.test(key)} onChange={next => onChange({ $form: (value.$form as CommandValue[]).map((pair, i) => i === index ? [key, String(next ?? "")] : pair) })} />)}</div>;
  }
  if (Array.isArray(value)) return <div className="space-y-3">{value.map((item, i) => <fieldset key={i} className="rounded border border-sand p-2"><legend className="px-1 text-xs text-steel">{fieldLabel(label)} {i + 1}</legend><ValueEditor value={item} label="Field" disabled={disabled} onChange={next => onChange(value.map((old, index) => index === i ? next : old))} /></fieldset>)}</div>;
  if (typeof value === "object") return <div className="grid gap-3 sm:grid-cols-2">{Object.entries(value).map(([key, item]) => internal.test(key) ? null : <ValueEditor key={key} label={key} value={item} disabled={disabled || key === "id" || /Id$/.test(key)} onChange={next => onChange({ ...value, [key]: next })} />)}</div>;
  if (typeof value === "string" && /Json$/.test(label)) {
    let parsed: CommandValue = null;
    try { parsed = JSON.parse(value) as CommandValue; } catch { /* show original input intact */ }
    if (parsed && typeof parsed === "object") return <ValueEditor label={label} value={parsed} disabled={disabled} onChange={next => onChange(JSON.stringify(next))} />;
  }
  return <label className="flex flex-col gap-1 text-xs text-steel">{fieldLabel(label)}
    {typeof value === "boolean" ? <input type="checkbox" checked={value} disabled={disabled} onChange={event => onChange(event.target.checked)} /> :
      <input className="h-9 rounded border border-sand bg-white px-2 text-sm text-ink disabled:bg-ivory" value={String(value)} readOnly={disabled} type={typeof value === "number" ? "number" : "text"} step="any" onChange={event => onChange(typeof value === "number" ? Number(event.target.value) : event.target.value)} />}
  </label>;
}
function download(entry: SavedCommand) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(entry, null, 2)], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = `saved-work-${entry.id}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function CommandReview({ entry, onClose }: { entry: SavedCommand; onClose: () => void }) {
  const [args, setArgs] = useState(entry.args);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const editable = entry.status === "failed";
  async function save() {
    const user = getClientUserId();
    if (!user) return;
    setBusy(true);
    try {
      if (new TextEncoder().encode(JSON.stringify({ ...entry, args })).length > COMMAND_LIMIT_BYTES - 1000) throw new Error("This correction is too large. Reduce the batch before retrying.");
      const updated = await changeCommand(user, entry.id, current => {
        if (current.status !== "failed") return current;
        const revised = confirmed ? confirmedArguments(entry.action, args) : args;
        return { ...current, args: revised, status: "pending", updatedAt: Date.now(), error: undefined, needsConfirmation: false };
      });
      if (!updated || updated.status !== "pending") throw new Error("This operation changed in another tab. Reopen its current status.");
      onClose();
    } catch (problem) { setError(problem instanceof Error ? problem.message : "Could not save the correction. Your original input is retained."); }
    finally { setBusy(false); }
  }
  return <Dialog title={entry.label} onClose={onClose} size="wide" footer={<div className="flex items-center justify-end gap-3"><button type="button" onClick={() => download(entry)} className="text-sm text-navy-800">Download a copy</button>{editable && <button type="button" disabled={busy || !!entry.needsConfirmation && !confirmed} onClick={() => void save()} className="rounded bg-navy-800 px-4 py-2 text-sm text-white disabled:opacity-40">{busy ? "Storing…" : "Save correction and retry"}</button>}</div>}>
    <p className="mb-3 text-sm text-steel">{entry.status === "confirmed" ? "Confirmed by the server." : "Stored on this device. Official invoice numbers and final balances appear after the server confirms the save."}</p>
    {entry.error && <p className="mb-3 text-sm text-error">{entry.error}</p>}
    {error && <p role="alert" className="mb-3 text-sm text-error">{error}</p>}
    {entry.needsConfirmation && <label className="mb-3 flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />I have reviewed the change described above and confirm it.</label>}
    {args.map((arg, index) => arg && typeof arg === "object" ? <ValueEditor key={index} label="Row" value={arg} disabled={!editable || busy} onChange={value => setArgs(old => old.map((item, i) => i === index ? value : item))} /> : null)}
  </Dialog>;
}
export function PendingWork() {
  const { commands, storageWarning, cancel } = useSync();
  const [selected, setSelected] = useState<string | null>(null);
  const active = commands.filter(unresolved);
  const reviewing = commands.find(row => row.id === selected);
  if (!active.length && !storageWarning && !reviewing) return null;
  return <section className="mb-3 rounded border border-brass-600 bg-white p-2 print:hidden" aria-label="Pending saved work">
    {storageWarning && <p role="alert" className="mb-2 text-sm text-error">{storageWarning}</p>}
    {active.length > 0 && <>
      <p role="status" className="mb-2 text-sm font-medium text-navy-800">{active.length} saved locally — awaiting server confirmation</p>
      <DataTable globalShortcuts={false} columns={columns} idKey="id" rows={active.map(row => ({ id: row.id, label: row.label, status: row.status === "failed" ? "Needs attention" : row.status === "syncing" ? "Syncing" : "Pending", message: row.error || "Open to review your input" }))} onRowClick={row => setSelected(String(row.id))} />
    </>}
    {reviewing && <><CommandReview key={reviewing.id} entry={reviewing} onClose={() => setSelected(null)} />{canCancel(reviewing) && <button type="button" className="text-xs text-steel" onClick={() => { if (confirm("Cancel this saved operation? Its input will stay recoverable.")) { cancel(reviewing.id); setSelected(null); } }}>Cancel saved operation</button>}</>}
  </section>;
}
