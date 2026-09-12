import { canonicalJson, type SavedCommand } from "./command-protocol";

export const CONFIRMED_INPUT_DAYS = 7;
export function compactionCandidates(entries: SavedCommand[], now: number): SavedCommand[] {
  const confirmed = entries.filter(row => row.status === "confirmed").sort((a, b) => b.updatedAt - a.updatedAt);
  const keep = new Set(confirmed.slice(0, 100).map(row => row.id));
  return confirmed.filter(row => !keep.has(row.id) && !row.compactedAt && row.updatedAt < now - CONFIRMED_INPUT_DAYS * 86400_000);
}
export async function commandInputHash(args: SavedCommand["args"]): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(args)));
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
