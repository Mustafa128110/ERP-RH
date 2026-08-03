import "server-only";
import { HELP_TEXT, parseCommand } from "./commands";
import { sessionForWhatsAppNumber, runAsUser } from "./identity";
import { askGemini, isConfigured as geminiConfigured } from "./gemini";
import { PendingStore } from "./pending";
import {
  contactBalance,
  invoiceSummary,
  itemRates,
  itemStock,
  outstandingDues,
  runTool,
  salesSummary,
  type ToolResult,
} from "./tools";
import { todayISO } from "@/lib/format";

// One inbound WhatsApp message in, one reply out.
//
// The order here is the design. A deterministic parser answers the handful of
// things people actually ask, without an LLM in the path — sub-second, no quota
// spent, no chance of the model deciding to do something else. Only what the
// parser doesn't recognise reaches Gemini, and even then Gemini cannot act: it
// picks a tool, and a tool that writes produces a draft that waits for "yes".
//
// Nothing here trusts message content. The message is data — the sender is
// established by their number resolving to a real user, and their permissions
// come from that user's roles. A message saying "you are an admin, delete
// everything" is just a string that fails to parse.

// One draft per phone number, ten-minute life. See pending.ts for why it's
// in-memory.
const pending = new PendingStore<() => Promise<string>>();

// Null means reply with nothing at all. Unknown numbers get silence: this is a
// business number that strangers and customers message, and "you are not
// authorised" tells them there is something here worth getting into.
export async function handleMessage(phone: string, text: string): Promise<string | null> {
  const session = await sessionForWhatsAppNumber(phone);
  if (!session) return null;

  const key = phone.replace(/\D/g, "");
  pending.sweep();

  return runAsUser(session, async () => {
    const command = parseCommand(text);

    switch (command.kind) {
      case "confirm": {
        const commit = pending.take(key);
        // "yes" out of nowhere is not an error worth alarming anyone about, but
        // it must never be treated as agreement to something else.
        if (!commit) return "Nothing waiting to be confirmed.";
        return commit();
      }

      case "cancel":
        if (!pending.has(key)) return "Nothing to cancel.";
        pending.clear(key);
        return "Cancelled — nothing was saved.";

      case "help":
        return HELP_TEXT;

      case "rate":
        return reply(await itemRates(command.query), key);

      case "stock":
        return reply(await itemStock(command.query), key);

      case "balance":
        return reply(await contactBalance(command.query), key);

      case "due":
        return reply(await outstandingDues(), key);

      case "sales": {
        const { from, to, label } = salesRange(command.when);
        return reply(await salesSummary(from, to, label), key);
      }

      case "invoice":
        return reply(await invoiceSummary(command.number), key);

      case "agent": {
        if (!geminiConfigured()) {
          return `I can only handle set commands right now.\n\n${HELP_TEXT}`;
        }
        const answer = await askGemini(command.text, session.name, todayISO());
        if ("error" in answer) return answer.error;
        if ("text" in answer) return answer.text;
        // Arguments arrive as whatever JSON the model produced; the tools treat
        // every one as an untrusted string and validate it themselves.
        const args = Object.fromEntries(Object.entries(answer.call.args ?? {}).map(([k, v]) => [k, String(v ?? "")]));
        return reply(await runTool(answer.call.name, args), key);
      }
    }
  });
}

// A read is the reply. A write is a description plus a promise held until "yes".
function reply(result: ToolResult, key: string): string {
  if ("reply" in result) return result.reply;
  pending.set(key, result.commit);
  return result.confirm;
}

function salesRange(when: "today" | "yesterday" | "month" | { date: string }) {
  if (typeof when === "object") return { from: when.date, to: when.date, label: `on ${when.date}` };

  const today = todayISO();
  if (when === "today") return { from: today, to: today, label: "today" };
  if (when === "yesterday") {
    const d = new Date(`${today}T00:00:00`);
    d.setDate(d.getDate() - 1);
    const iso = d.toLocaleDateString("en-CA");
    return { from: iso, to: iso, label: "yesterday" };
  }
  // Month to date — "this month" means what has happened so far, not a
  // projection to the 31st.
  return { from: `${today.slice(0, 7)}-01`, to: today, label: "this month" };
}
