import "server-only";
import { createHash } from "node:crypto";
import { HELP_TEXT, parseCommand } from "./commands";
import { sessionForWhatsAppNumber, runAsWhatsAppUser } from "./identity";
import { geminiConfigured, selectTool } from "./gemini";
import { appendConversation, clearConversation, clearPending, finishInbound, getConversation, hasPending, releaseInbound, savePending, takePending, type InboundClaim, claimInbound } from "./state";
import { commitDraft, runTool, type ToolResult } from "./tools";
import { normalizeWhatsAppNumber } from "./phone";
import { todayISO } from "@/lib/format";

export type InboundOutcome = { reply: string | null; retry: boolean };

function operationId(messageId: string) {
  return `wa-${createHash("sha256").update(messageId).digest("hex").slice(0, 48)}`;
}

function salesRange(when: "today" | "yesterday" | "month" | { date: string }) {
  const today = todayISO();
  if (typeof when === "object") return { from: when.date, to: when.date };
  if (when === "today") return { from: today, to: today };
  if (when === "yesterday") {
    const date = new Date(`${today}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() - 1);
    const iso = date.toISOString().slice(0, 10);
    return { from: iso, to: iso };
  }
  return { from: `${today.slice(0, 7)}-01`, to: today };
}

async function replyForTool(phone: string, userId: string, messageId: string, result: ToolResult): Promise<string> {
  if ("reply" in result) return result.reply;
  const saved = await savePending({ phone, userId, operationId: operationId(messageId), ...result.draft });
  return saved ? result.draft.confirmation : "I could not safely hold that draft. Nothing was saved; please try again.";
}

// The caller has already verified the Meta signature. Unknown numbers are
// deliberately handled before deduplication and get no reply at all.
export async function handleInboundMessage(message: { id: string; from: string; text: string }): Promise<InboundOutcome> {
  const phone = normalizeWhatsAppNumber(message.from);
  if (!phone) return { reply: null, retry: false };
  const session = await sessionForWhatsAppNumber(phone);
  if (!session) return { reply: null, retry: false };

  const claim: InboundClaim = await claimInbound(message.id);
  if (claim === "unavailable") return { reply: null, retry: true };
  if (claim !== "claimed") return { reply: null, retry: false };

  try {
    const reply = await runAsWhatsAppUser(session, async () => {
      const command = parseCommand(message.text);
      switch (command.kind) {
        case "help": return HELP_TEXT;
        case "confirm": {
          const draft = await takePending(phone);
          if (!draft) return "Nothing waiting to be confirmed.";
          if (draft.userId !== session.userId || draft.phone !== phone) return "That draft is no longer available.";
          const committed = await commitDraft(draft);
          await clearConversation(phone);
          return committed;
        }
        case "cancel":
          if (!(await hasPending(phone))) return "Nothing to cancel.";
          await clearPending(phone);
          await clearConversation(phone);
          return "Cancelled — nothing was saved.";
        case "rate": return replyForTool(phone, session.userId, message.id, await runTool("item_rates", { item: command.query }));
        case "stock": return replyForTool(phone, session.userId, message.id, await runTool("item_stock", { item: command.query }));
        case "items": return replyForTool(phone, session.userId, message.id, await runTool("search_items", { query: command.query }));
        case "balance": return replyForTool(phone, session.userId, message.id, await runTool("contact_balance", { contact: command.query }));
        case "due": return replyForTool(phone, session.userId, message.id, await runTool("outstanding_dues", {}));
        case "sales": {
          const range = salesRange(command.when);
          return replyForTool(phone, session.userId, message.id, await runTool("sales_summary", range));
        }
        case "invoice": return replyForTool(phone, session.userId, message.id, await runTool("invoice_summary", { number: command.number }));
        case "agent": {
          if (!geminiConfigured()) return `I can handle the commands below while the AI assistant is unavailable.\n\n${HELP_TEXT}`;
          const selection = await selectTool(command.text, await getConversation(phone));
          if (!selection) return "I could not understand that just now. Send *help* to see what I can do.";
          return replyForTool(phone, session.userId, message.id, await runTool(selection.name, selection.args));
        }
      }
    });
    const exact = message.text.trim().toLowerCase().replace(/[.!?]+$/g, "");
    if (exact !== "yes" && !/^(?:n|no|cancel|stop|nahi|nai|nahin|rehne|chor)$/.test(exact)) {
      await appendConversation(phone, [{ role: "user", text: message.text }, { role: "assistant", text: reply }]);
    }
    await finishInbound(message.id);
    return { reply, retry: false };
  } catch (error) {
    await releaseInbound(message.id);
    console.error("[whatsapp-agent] inbound processing failed", error instanceof Error ? error.message : "unknown");
    return { reply: "I could not complete that. Nothing new was saved; please try again.", retry: false };
  }
}
