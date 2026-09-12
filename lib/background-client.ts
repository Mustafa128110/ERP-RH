"use client";
import { getClientUserId } from "@/lib/client-user";
import { addCommand, listCommands, requestWorkPersistence } from "@/lib/command-store";
import { COMMAND_EVENT, COMMAND_LIMIT_BYTES, encodeArgument, commandLabel, type SavedCommand, type CommandValue } from "@/lib/command-protocol";
import { tableForCommand } from "@/lib/command-tables";
import { decodeCacheValue } from "@/lib/cache-codec";
import { clearDraft, draftOperationId } from "@/lib/draft";

const revisions = new Map<string, string>();
let revisionUser: string | null = null;
let storing = 0;
let pendingHint = 0;
export function setPendingCommandCount(count: number) { pendingHint = count; }
export function localWritesPending() { return storing > 0 || pendingHint > 0; }
export function rememberRevisions(values: Record<string, string>) {
  const user = getClientUserId();
  if (revisionUser !== user) { revisions.clear(); revisionUser = user; }
  // Freshly opened records can advance their base. A later hover must not
  // replace the version that an already-open editor was populated from.
  const editing = new Set([...document.querySelectorAll<HTMLElement>('[data-command-record]')].map(node => node.dataset.commandRecord));
  for (const [key, value] of Object.entries(values)) {
    if (!revisions.has(key) || !editing.has(key.slice(key.indexOf(":") + 1))) revisions.set(key, value);
  }
}
function referencedIds(value: CommandValue, ids = new Set<string>()): Set<string> {
  if (typeof value === "string") ids.add(value);
  else if (Array.isArray(value)) for (const item of value) referencedIds(item, ids);
  else if (value && typeof value === "object") for (const item of Object.values(value)) referencedIds(item, ids);
  return ids;
}
export async function queueBackgroundAction(action: string, rawArgs: unknown[], path = window.location.pathname) {
  const userId = getClientUserId();
  if (!userId) return { error: "Your account is still loading. Keep this form open and try again." };
  if (revisionUser !== userId) { revisions.clear(); revisionUser = userId; }
  storing++;
  window.dispatchEvent(new Event(COMMAND_EVENT));
  try {
    const args = rawArgs.map(encodeArgument);
    const submittedForm = rawArgs.find(arg => arg instanceof FormData) as FormData | undefined;
    const formId = submittedForm?.get("operationId");
    const formElement = [...document.querySelectorAll<HTMLFormElement>("form[data-draft-key]")].find(form => form.querySelector<HTMLInputElement>('[name="operationId"]')?.value === formId);
    const batchEditor = document.querySelector<HTMLElement>('[role="dialog"] [data-batch-draft-key]');
    const batchDraft = batchEditor?.dataset.batchDraftKey;
    const draftKey = formElement?.dataset.draftKey || (!submittedForm ? batchDraft : undefined);
    // The previous useActionState result isn't part of the business input.
    const formIndex = args.findIndex(arg => arg && !Array.isArray(arg) && typeof arg === "object" && "$form" in arg);
    if (formIndex > 0) args[formIndex - 1] = null;
    const table = tableForCommand(action);
    const ids = referencedIds(args);
    const editors = [...document.querySelectorAll<HTMLElement>('[data-command-table][data-command-record]')]
      .filter(node => node.dataset.commandTable === table && ids.has(node.dataset.commandRecord!));
    const editor = editors.find(node => node.contains(document.activeElement)) ?? editors[0];
    if (editor && !editor.dataset.commandRevision) return { error: "Refresh this page to load the record version before saving." };
    // A queued delete does not contain the unsaved edit fields. Retain that
    // draft in case deletion is refused; only an update transfers its input.
    const creating = [...document.querySelectorAll<HTMLElement>('[data-command-create-action]')].find(node => node.dataset.commandCreateAction === action);
    const recoveryKey = creating?.dataset.recoveryKey ?? (/^(update|set)/.test(action.split(".")[1]) ? editor?.dataset.recoveryKey : undefined);
    const expected = Object.fromEntries([...revisions].filter(([key]) => table && key.startsWith(`${table}:`) && ids.has(key.slice(table.length + 1))));
    if (editor?.dataset.commandRevision) expected[`${table}:${editor.dataset.commandRecord}`] = editor.dataset.commandRevision;
    const relatedVersions = (creating ?? editor)?.dataset.commandRevisions;
    if (table && relatedVersions) {
      const related = JSON.parse(relatedVersions) as Record<string, string>;
      for (const [key, value] of Object.entries(related)) if (key.startsWith(`${table}:`)) {
        if (!/^\d+$/.test(value)) return { error: "Reopen this record to load the linked record versions." };
        expected[key] = value;
      }
    }
    if (!submittedForm && table && batchEditor && batchEditor.dataset.commandTable === table && batchEditor.dataset.commandRevisions) {
      const base = JSON.parse(batchEditor.dataset.commandRevisions) as Record<string, string>;
      for (const [key, value] of Object.entries(base)) if (key.startsWith(`${table}:`) && ids.has(key.slice(table!.length + 1))) {
        if (!/^\d+$/.test(value)) return { error: "Reopen this batch to load the current record versions." };
        expected[key] = value;
      }
    }
    const command: SavedCommand = {
      id: recoveryKey && draftOperationId(recoveryKey) || draftKey && draftOperationId(draftKey) || crypto.randomUUID(), userId, action, args, path,
      label: commandLabel(action, args), version: 1, createdAt: Date.now(), updatedAt: Date.now(),
      status: "pending", attempts: 0, revisions: expected,
    };
    // A command always carries its own permanent action identity; component
    // remounts and old form IDs cannot accidentally reuse another sale's claim.
    if (formIndex >= 0) {
      const form = args[formIndex] as { $form: CommandValue[] };
      form.$form = form.$form.filter(pair => !Array.isArray(pair) || pair[0] !== "operationId");
      form.$form.push(["operationId", command.id]);
    }
    if (["expenses.createExpensesBatch", "payments.createPaymentsBatch", "accounts.createChequesBatch"].includes(action)) args[1] = command.id;
    if (new TextEncoder().encode(JSON.stringify(command)).length > COMMAND_LIMIT_BYTES - 1000) return { error: "This batch is too large. Split it before saving." };
    await addCommand(command);
    if (recoveryKey) clearDraft(recoveryKey);
    if (draftKey && batchEditor?.dataset.commandRevisions) clearDraft(draftKey);
    pendingHint++;
    void requestWorkPersistence();
    return { success: true, queued: true, operationId: command.id };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "This browser could not store your work. Keep this form open." };
  } finally {
    storing--;
    window.dispatchEvent(new Event(COMMAND_EVENT));
  }
}

type AsyncAction = (...args: never[]) => Promise<unknown>;
export function backgroundAction<F extends AsyncAction>(action: string, confirmedAction: F): F {
  return (async (...args: unknown[]) => {
    // Quick-add feeds a foreign-key picker and needs a real server ID before
    // its parent can use the new option. Those dialogs explicitly opt out.
    if (document.querySelector('[data-requires-confirmed-save="true"]')) return confirmedAction(...args as never[]);
    return queueBackgroundAction(action, args);
  }) as unknown as F;
}
export function backgroundRead<F extends AsyncAction>(action: string, original: F): F {
  // Lists use their existing cache. Detail reads capture an edit revision.
  if (action.split(".")[1].startsWith("list")) return original;
  return (async (...args: unknown[]) => {
    if (!navigator.onLine) throw new Error("Reconnect to open the latest version of this record. Your queued work remains saved locally.");
    const response = await fetch("/api/commands", {
      method: "POST", headers: { "Content-Type": "application/json", "x-erp-command": "1" },
      body: JSON.stringify({ mode: "read", action, args: args.map(encodeArgument) }),
      signal: AbortSignal.timeout(30_000),
    });
    const body = await response.json();
    if (!response.ok || body.error) throw new Error(body.error || "Couldn't load this record.");
    rememberRevisions(body.revisions ?? {});
    return decodeCacheValue(body.encoded);
  }) as unknown as F;
}
export async function hasQueuedWork(): Promise<boolean> {
  const userId = getClientUserId();
  return storing > 0 || !!userId && (await listCommands(userId)).some(command => ["pending", "syncing", "failed"].includes(command.status));
}
