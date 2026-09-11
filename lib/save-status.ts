export function isQueuedSave(value: unknown): boolean {
  return !!value && typeof value === "object" && "queued" in value && value.queued === true;
}
export function saveStatus(value: unknown): string {
  return isQueuedSave(value) ? "Saved on this device — waiting to sync." : "Saved.";
}
