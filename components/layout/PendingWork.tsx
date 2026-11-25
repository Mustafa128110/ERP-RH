"use client";
import { useState } from "react";
import { useSync } from "./SyncProvider";
import { DataTable } from "@/components/ui/DataTable";
import { Dialog } from "@/components/ui/Dialog";
import { changeCommand } from "@/lib/command-store";
import { getClientUserId } from "@/lib/client-user";
import { COMMAND_LIMIT_BYTES, confirmedArguments, unresolved, type SavedCommand, type CommandValue } from "@/lib/command-protocol";
import { canCancel } from "@/lib/command-sync";
import {CorrectionFields as ValueEditor} from "./CorrectionFields";
import {correctionRead} from "@/lib/correction-read";
import {decodeCacheValue} from "@/lib/cache-codec";
import {encodeArgument} from "@/lib/command-protocol";
import type { ColumnDef } from "@/lib/table";

const columns: ColumnDef[] = [
  { key: "label", label: "Your saved work" }, { key: "status", label: "Status" }, { key: "message", label: "Details" },
];
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
  const [latest,setLatest]=useState<{value:CommandValue;revisions:Record<string,string>}|null>(null);
  const [reviewed,setReviewed]=useState(false);
  const stale=/changed.*(opened|tab)|latest record/i.test(entry.error??"");
  async function loadLatest(){const read=correctionRead(entry);if(!read){setError("Open this record's page to review its latest version before retrying.");return;}setBusy(true);setError(null);try{const response=await fetch("/api/commands",{method:"POST",headers:{"Content-Type":"application/json","x-erp-command":"1"},body:JSON.stringify({mode:"read",action:read.action,args:read.args.map(encodeArgument)}),signal:AbortSignal.timeout(30000)});const body=await response.json();if(!response.ok||body.error)throw new Error(body.error||"Could not load the latest record.");if(Object.keys(entry.revisions??{}).some(key=>!body.revisions?.[key]))throw new Error("Not all latest versions could be loaded. Open the original record page and review this batch there.");setLatest({value:JSON.parse(JSON.stringify(decodeCacheValue(body.encoded))),revisions:body.revisions??{}});setReviewed(false);}catch(problem){setError(problem instanceof Error?problem.message:"Could not load the latest record.");}finally{setBusy(false);}}

  async function save() {
    const user = getClientUserId();
    if (!user) return;
    setBusy(true);
    try {
      if (new TextEncoder().encode(JSON.stringify({ ...entry, args })).length > COMMAND_LIMIT_BYTES - 1000) throw new Error("This correction is too large. Reduce the batch before retrying.");
      const updated = await changeCommand(user, entry.id, current => {
        if (current.status !== "failed"||current.updatedAt!==entry.updatedAt) return current;
        let revised = confirmed ? confirmedArguments(entry.action, args) : args;
        const versions=reviewed&&latest?latest.revisions:current.revisions;
        if(reviewed&&latest&&entry.action==="products.saveStockSheet")revised=revised.map(arg=>Array.isArray(arg)?arg.map(row=>row&&typeof row==="object"&&!Array.isArray(row)?{...row,_revision:versions?.[`items:${row.id}`]??row._revision}:row):arg);
        return { ...current, revisions:versions, args: revised, status: "pending", updatedAt: Date.now(), error: undefined, needsConfirmation: false };
      });
      if (!updated || updated.status !== "pending") throw new Error("This operation changed in another tab. Reopen its current status.");
      onClose();
    } catch (problem) { setError(problem instanceof Error ? problem.message : "Could not save the correction. Your original input is retained."); }
    finally { setBusy(false); }
  }
  return <Dialog title={`${editable?"Correct: ":""}${entry.label}`} onClose={onClose} size="wide" footer={<div className="flex items-center justify-end gap-3"><button type="button" onClick={() => download(entry)} className="text-sm text-navy-800">Download a copy</button>{editable && <button type="button" disabled={busy || !!entry.needsConfirmation && !confirmed || stale&&(!latest||!reviewed)} onClick={() => void save()} className="rounded bg-navy-800 px-4 py-2 text-sm text-white disabled:opacity-40">{busy ? "Storing…" : "Save correction and retry"}</button>}</div>}>
    <p className="mb-3 text-sm text-steel">{entry.status === "confirmed" ? "Confirmed by the server." : "Stored on this device. Official invoice numbers and final balances appear after the server confirms the save."}</p>
    {entry.error&&<div role="alert" className="mb-4 rounded border border-error/30 bg-rose-50 p-3 text-sm"><p className="font-semibold text-error">What needs correcting</p><p className="mt-1 text-ink whitespace-pre-wrap">{entry.error}</p><p className="mt-2 text-steel">Edit the affected fields below, then save the correction to retry this same operation.</p></div>}
    {stale&&<div className="mb-4 rounded border border-sand p-3 text-sm"><button type="button" disabled={busy} onClick={()=>void loadLatest()} className="rounded border border-sand px-3 py-2">Load latest details for comparison</button>{latest&&<><details className="my-3"><summary>Latest saved details</summary><ValueEditor label="Latest record" value={latest.value} disabled onChange={()=>{}}/></details><label className="flex items-start gap-2"><input type="checkbox" checked={reviewed} onChange={event=>setReviewed(event.target.checked)}/>I compared the latest details with my corrections below and want to save these corrections.</label></>}</div>}
    {entry.compactedAt && <p className="mb-3 text-sm text-steel">This older confirmed operation retains its receipt. Open its saved record for the current details.</p>}
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
