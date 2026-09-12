"use client";
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { flushSync } from "react-dom";
import { clearDraft, draftSnapshot, noDraft, resetDraftSnapshot, saveDraft, subscribeDraft } from "@/lib/draft";
import { useClientUserId } from "@/lib/client-user";
import { encodeCacheValue, decodeCacheValue } from "@/lib/cache-codec";
import { recordFields, restoreRecordFields } from "@/lib/record-recovery";

type Registered = { value: unknown; restore: (value: unknown) => void };
type RecoveryContext = { fields: Map<string, Registered> };
const Context = createContext<RecoveryContext | null>(null);
type Draft = { revision: string; fields: [string, string][]; states: Record<string, string>; dates: [string, string][] };
const stringPairs = (value: unknown): value is [string, string][] => Array.isArray(value) && value.every(pair => Array.isArray(pair) && pair.length === 2 && pair.every(part => typeof part === "string"));
function sameKind(value: unknown, current: unknown): boolean {
  if (current instanceof Set) return value instanceof Set;
  if (current instanceof Map) return value instanceof Map;
  if (Array.isArray(current)) return Array.isArray(value);
  if (current === null) return value === null || typeof value === "object";
  if (typeof current === "object") return !!value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Set) && !(value instanceof Map);
  return typeof value === typeof current;
}
export function revisionOf(value: object): string | undefined { return (value as { _revision?: string })._revision; }

export function RecoveryValue({ name, value, restore }: { name: string; value: unknown; restore: (value: unknown) => void }) {
  const context = useContext(Context);
  useLayoutEffect(() => {
    context?.fields.set(name, { value, restore });
    return () => { context?.fields.delete(name); };
  }, [context, name, value, restore]);
  return null;
}

// Field state opts into recovery by name. UI flags and fetched option lists keep
// ordinary useState so old drafts cannot replace fresh reference data.
export function useRecoveryState<T>(name: string, initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState(initial);
  const context = useContext(Context);
  useLayoutEffect(() => {
    context?.fields.set(name, { value, restore: next => setValue(next as T) });
    return () => { context?.fields.delete(name); };
  }, [context, name, value]);
  return [value, setValue];
}

export function FormRecovery({ domain, id, revision, children, draftSuffix = "", createAction, revisions }: { domain: string; id: string; revision?: string; children: ReactNode; draftSuffix?: string; createAction?: string; revisions?: Record<string,string> }) {
  const user = useClientUserId();
  const key = `${createAction ? "create" : "edit"}:${user}:${domain}:${id}${draftSuffix ? `:${draftSuffix}` : ""}`;
  const root = useRef<HTMLDivElement>(null);
  const context = useMemo<RecoveryContext>(() => ({ fields: new Map() }), []);
  const saved = useSyncExternalStore(subscribeDraft, () => draftSnapshot<Draft>(key), noDraft);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const restoring = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushPending = useRef<() => void>(() => {});
  const offered = !!saved && dismissedKey !== key;
  const restorable = !!saved && saved.revision === revision && stringPairs(saved.fields) && stringPairs(saved.dates) && !!saved.states && typeof saved.states === "object" && !Array.isArray(saved.states) && Object.values(saved.states).every(value => typeof value === "string");
  function persist() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const form = root.current?.querySelector("form");
    if (!form || !revision || offered || restoring.current) return;
    const states = Object.fromEntries([...context.fields].map(([name, field]) => [name, encodeCacheValue(field.value)]));
    const dates: [string, string][] = [...form.querySelectorAll<HTMLElement>('[data-date-field]')].map(node => [node.dataset.dateField!, node.querySelector<HTMLInputElement>('input[type="hidden"]')?.value ?? ""]);
    setError(!saveDraft(key, { revision, fields: recordFields(form), states, dates } satisfies Draft));
  }
  function touch() {
    if (offered || restoring.current || timer.current) return;
    timer.current = setTimeout(persist, 0);
  }
  useLayoutEffect(() => { flushPending.current = () => { if (timer.current) persist(); }; });
  // Flush before React removes the form, and before the browser closes it.
  // Merely clearing the timer can drop the last keystroke on fast navigation.
  useLayoutEffect(() => () => { flushPending.current(); resetDraftSnapshot(key); }, [key]);
  useEffect(() => {
    const flush = () => flushPending.current();
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    return () => { window.removeEventListener("pagehide", flush); window.removeEventListener("beforeunload", flush); };
  }, []);
  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(saved, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `unsaved-${domain}-${id}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <Context.Provider value={context}><div ref={root} className="contents" data-command-table={domain} data-command-record={createAction ? undefined : id} data-command-create-action={createAction} data-command-revision={revision} data-command-revisions={revisions ? JSON.stringify(revisions) : undefined} data-recovery-key={key}
    onInputCapture={touch} onChangeCapture={touch}
    onClickCapture={event => { if ((event.target as Element).closest('fieldset button[type="button"]')) touch(); }}
    onSubmitCapture={() => { if (timer.current) persist(); }}>
    {offered && <div className="mb-3 rounded border border-brass-600 bg-brass-100 p-3 text-sm">
      <p>{restorable ? "You have an unsaved edit. Restore or discard it before continuing." : "This record changed or the old draft cannot be restored automatically. Download your input to review it against the latest record."}</p>
      <div className="mt-2 flex gap-3">
        {restorable && <button type="button" onClick={() => {
          const form = root.current?.querySelector("form"); if (!form) return;
          restoring.current = true;
          try {
            const states = Object.entries(saved.states).map(([name, value]) => [name, decodeCacheValue(value)] as const);
            // Reject malformed stored state before any setter can unmount the
            // form. Keep the original draft available for download/discard.
            for (const [name, value] of states) {
              const field = context.fields.get(name);
              if (field && !sameKind(value, field.value)) throw new Error("Invalid recovery field");
            }
            flushSync(() => { for (const [name, value] of states) context.fields.get(name)?.restore(value); });
            flushSync(() => {
              restoreRecordFields(form, saved.fields, true);
              for (const [name, value] of saved.dates) {
                const node = [...form.querySelectorAll<HTMLElement>('[data-date-field]')].find(node => node.dataset.dateField === name);
                node?.dispatchEvent(new CustomEvent("erp:restore-date", { detail: value }));
              }
            });
            setDismissedKey(key);
          } catch { setError(true); }
          finally { restoring.current = false; }
        }}>Restore edit</button>}
        <button type="button" onClick={download}>Download a copy</button>
        <button type="button" onClick={() => { clearDraft(key); setDismissedKey(key); }}>Discard edit</button>
      </div>
    </div>}
    {!revision && <p role="alert">Refresh to load this record&apos;s version before editing.</p>}
    {error && <p role="alert">This browser could not preserve or restore the edit. Keep this form open until it is saved.</p>}
    <fieldset className="contents" disabled={offered || !revision}>{children}</fieldset>
  </div></Context.Provider>;
}
