import { getLiveSession } from "@/lib/auth/session";
import { guard } from "@/lib/actions/guard";
import { executeCommand, executeRead } from "@/lib/command-executor";
import { COMMAND_LIMIT_BYTES, type SavedCommand, type CommandValue } from "@/lib/command-protocol";
import { encodeCacheValue } from "@/lib/cache-codec";

async function readBody(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Missing request");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > COMMAND_LIMIT_BYTES) { await reader.cancel(); throw new Error("Request too large"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(bytes));
}
export async function POST(request: Request) {
  const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
  if (request.headers.get("origin") !== new URL(request.url).origin || request.headers.get("x-erp-command") !== "1") return json({ error: "Invalid request origin." }, 403);
  let body: { mode?: string; action?: string; args?: CommandValue[]; command?: SavedCommand };
  try {
    const input = await readBody(request);
    if (!input || typeof input !== "object" || Array.isArray(input)) return json({ error: "Invalid request." }, 400);
    body = input;
  } catch { return json({ error: "Invalid or oversized request." }, 400); }
  const session = await guard("Sign in to sync your work.", async () => ({ session: await getLiveSession() }));
  if (!("session" in session) || !session.session) return json({ error: "Sign in to sync your saved work." }, 401);
  if (body.mode === "read" && typeof body.action === "string" && Array.isArray(body.args)) {
    const result = await guard("Couldn't load this record.", () => executeRead(body.action!, body.args!));
    if ("error" in result) return json(result, 400);
    return json({ encoded: encodeCacheValue(result.result), revisions: result.revisions });
  }
  const command = body.command;
  if (!command || typeof command.action !== "string" || typeof command.id !== "string" || !Array.isArray(command.args) ||
    command.revisions != null && (typeof command.revisions !== "object" || Array.isArray(command.revisions) || Object.values(command.revisions).some(v => typeof v !== "string"))) return json({ error: "Invalid saved operation." }, 400);
  const result = await guard("The save could not be confirmed. Your input remains saved locally and will be retried.", () => executeCommand(command, session.session!.userId));
  if ("error" in result) return json({ outcome: "unknown", result });
  return json(result);
}
