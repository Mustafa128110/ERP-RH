export type CommandValue = null | boolean | number | string | CommandValue[] | { [key: string]: CommandValue };
export type CommandState = "pending" | "syncing" | "failed" | "confirmed" | "cancelled" | "discarded";
export type SavedCommand = {
  id: string; userId: string; action: string; args: CommandValue[];
  path: string; label: string; version: 1; createdAt: number; updatedAt: number;
  status: CommandState; attempts: number; error?: string; needsConfirmation?: boolean;
  result?: CommandValue;
  revisions?: Record<string, string>;
  compactedAt?: number;
  inputHash?: string;
};
export const COMMAND_LIMIT_BYTES = 900_000;
export const COMMAND_EVENT = "erp:commands-changed";
export function unresolved(command: Pick<SavedCommand, "status">): boolean {
  return command.status === "pending" || command.status === "syncing" || command.status === "failed";
}
export function encodeArgument(value: unknown): CommandValue {
  if (value === undefined || value === null) return null;
  if (value instanceof FormData) {
    const entries = [...value.entries()].map(([key, entry]) => {
      if (typeof entry !== "string") throw new Error("Files need an online save. Keep this form open and try again online.");
      return [key, entry];
    });
    return { $form: entries };
  }
  if (Array.isArray(value)) return value.map(encodeArgument);
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, encodeArgument(entry)]));
  }
  throw new Error("This input could not be stored safely. Keep the form open.");
}
export function decodeArgument(value: CommandValue): unknown {
  if (value && !Array.isArray(value) && typeof value === "object" && Array.isArray(value.$form)) {
    const form = new FormData();
    for (const pair of value.$form) {
      if (!Array.isArray(pair) || pair.length !== 2 || pair.some((v) => typeof v !== "string")) throw new Error("Invalid saved form");
      form.append(pair[0] as string, pair[1] as string);
    }
    return form;
  }
  if (Array.isArray(value)) return value.map(decodeArgument);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, decodeArgument(v)]));
  return value;
}
export function commandFields(args: CommandValue[]): Record<string, CommandValue> {
  for (const arg of args) {
    if (arg && typeof arg === "object" && !Array.isArray(arg) && Array.isArray(arg.$form)) {
      return Object.fromEntries((arg.$form as string[][]).map(([k, v]) => [k, v]));
    }
  }
  const row = args.find((arg) => Array.isArray(arg) && arg.length && typeof arg[0] === "object");
  if (Array.isArray(row) && row[0] && !Array.isArray(row[0]) && typeof row[0] === "object") return row[0];
  return {};
}
export function commandLabel(action: string, args: CommandValue[]): string {
  const name = action.split(".")[1].replace(/([a-z])([A-Z])/g, "$1 $2").replace(/Batch$/, "");
  const fields = commandFields(args);
  const detail = fields.contactName || fields.name || fields.displayName || fields.number || fields.description;
  return `${name.charAt(0).toUpperCase()}${name.slice(1)}${typeof detail === "string" && detail ? ` — ${detail}` : ""}`;
}
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return "{" + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",") + "}";
  return JSON.stringify(value) ?? "null";
}

// Explicit confirmation is attached only after the saved refusal is reviewed.
export function confirmedArguments(action: string, args: CommandValue[]): CommandValue[] {
  if (action === "ledger.deleteLedgerRow") return [args[0], true];
  return args.map(arg => {
    if (arg && !Array.isArray(arg) && typeof arg === "object" && Array.isArray(arg.$form)) {
      return { $form: [...arg.$form.filter(pair => !Array.isArray(pair) || pair[0] !== "confirmAllocations"), ["confirmAllocations", "1"]] };
    }
    return arg;
  });
}
