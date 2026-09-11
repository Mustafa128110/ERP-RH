export type RecordDraft = { revision: string; fields: [string, string][] };
export function isRecordDraft(value: unknown): value is RecordDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<RecordDraft>;
  return typeof draft.revision === "string" && /^\d+$/.test(draft.revision) && Array.isArray(draft.fields) &&
    draft.fields.every(pair => Array.isArray(pair) && pair.length === 2 && pair.every(field => typeof field === "string"));
}

// Only native, non-secret edit controls are included. Metadata and submit
// buttons do not belong in a recovery copy of what the person typed.
export function recordFields(form: HTMLFormElement): [string, string][] {
  const names = new Set([...form.elements].filter(element =>
    (element instanceof HTMLInputElement && !["password", "file", "hidden", "submit", "button"].includes(element.type)) ||
    element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement,
  ).map(element => (element as HTMLInputElement).name).filter(Boolean));
  return [...new FormData(form)].filter((pair): pair is [string, string] => names.has(pair[0]) && typeof pair[1] === "string");
}

export function restoreRecordFields(form: HTMLFormElement, fields: [string, string][]): void {
  for (const element of form.elements) {
    if (!(element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement)) continue;
    if (element instanceof HTMLInputElement && ["password", "file", "hidden", "submit", "button"].includes(element.type)) continue;
    if (!element.name) continue;
    const values = fields.filter(([name]) => name === element.name).map(([, value]) => value);
    if (element instanceof HTMLInputElement && ["checkbox", "radio"].includes(element.type)) element.checked = values.includes(element.value);
    else if (element instanceof HTMLSelectElement && element.multiple) for (const option of element.options) option.selected = values.includes(option.value);
    else element.value = values[0] ?? "";
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }
}
