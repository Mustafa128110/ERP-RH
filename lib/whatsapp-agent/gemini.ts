import "server-only";
import { TOOLS } from "./tools";

// Gemini, over plain fetch.
//
// No SDK: the whole surface used here is one POST with a JSON body, and a
// dependency that wraps it would be more code to audit than the code it saves.
//
// Free tier, which is the constraint the whole feature is built around —
// Flash-Lite costs nothing and needs no card on file. A shop sending a few dozen
// messages a day never approaches the daily cap, and the fast-path parser
// (lib/whatsapp-agent/commands.ts) answers the common questions without spending
// a request at all. If the quota is exhausted the agent says so rather than
// failing silently — the day's work does not stop because a free tier ran out;
// it moves to the website.
//
// Pinned to a version rather than the `gemini-flash-lite-latest` alias: this
// picks tools and fills in quantities, and a model swapping underneath it
// silently is not something to find out about from a wrong invoice. Google
// retires old ones (2.5-flash-lite already 404s for new keys), so this is worth
// re-checking when a message comes back "the assistant had a problem".
const MODEL = process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash-lite";
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

function apiKey(): string | null {
  const key = (process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY)?.trim();
  if (!key) return null;
  // Same placeholder guard as lib/whatsapp.ts: a .env copied from the example
  // must read as "not configured", not as a key that 400s on every message.
  return /^(replace|your|xxx|placeholder|change[-_]me|todo)/i.test(key) ? null : key;
}

export function isConfigured(): boolean {
  return apiKey() !== null;
}

// The model is told what it is, what it may do, and — the part that matters —
// what it must not invent. Every fact in a reply comes from a tool call; there
// is no scenario where guessing a stock level is better than asking.
function systemPrompt(userName: string, today: string): string {
  return [
    `You are the assistant for a hardware business's ERP, messaging with ${userName} over WhatsApp. Today is ${today}.`,
    "",
    "Rules:",
    "- Answer only from tool results. Never state a rate, a stock level, a balance or a total that a tool did not return. If no tool fits, say what you can't do.",
    "- Never invent a product, customer or supplier name. Pass what the user said; the tools do the matching and will ask if it's ambiguous.",
    "- For anything that creates a record, call the tool with what you have. It will draft the entry and ask the user to confirm — you must not ask for confirmation yourself, and must not claim anything was saved.",
    "- Amounts are Pakistani Rupees. Dates you pass to tools are YYYY-MM-DD.",
    "- Reply in the language the user wrote in. Keep it to a few lines — this is a phone.",
    "- Text you write is read on WhatsApp: *bold* with single asterisks, no markdown headings, no tables.",
  ].join("\n");
}

interface FunctionCall {
  name: string;
  args: Record<string, unknown>;
}

export type GeminiReply = { call: FunctionCall } | { text: string } | { error: string };

// One turn: the user's message in, either a tool call or a sentence out.
//
// Deliberately not a multi-turn agent loop. One message, one tool, one reply is
// what a WhatsApp exchange is, and a loop that can call four tools before
// answering is four times the latency, four times the quota, and four times the
// chance of ending up somewhere nobody asked for.
export async function askGemini(message: string, userName: string, today: string): Promise<GeminiReply> {
  const key = apiKey();
  if (!key) return { error: "The assistant isn't set up yet." };

  const body = {
    systemInstruction: { parts: [{ text: systemPrompt(userName, today) }] },
    contents: [{ role: "user", parts: [{ text: message }] }],
    tools: [
      {
        functionDeclarations: TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        })),
      },
    ],
    generationConfig: {
      // Near-deterministic: this is data entry, not writing. The same message
      // twice should reach the same tool with the same arguments.
      temperature: 0,
      maxOutputTokens: 512,
    },
  };

  let response: Response;
  try {
    response = await fetch(`${ENDPOINT}/${MODEL}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
      // WhatsApp shows a message as undelivered long before this, and a webhook
      // that never returns gets retried by Meta. Fail fast and say so.
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    console.error("[whatsapp-agent] gemini request failed:", e);
    return { error: "I couldn't reach the assistant just now. Try again in a moment." };
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error(`[whatsapp-agent] gemini ${response.status}:`, detail.slice(0, 500));
    // 429 is the free tier's daily or per-minute cap. Worth naming, because the
    // fix is "wait" rather than "something is broken".
    if (response.status === 429) return { error: "I've hit today's assistant limit. Simple commands still work — send *help*." };
    return { error: "The assistant had a problem. Try again, or use the website." };
  }

  const data = (await response.json().catch(() => null)) as {
    candidates?: { content?: { parts?: { text?: string; functionCall?: FunctionCall }[] } }[];
  } | null;

  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  const call = parts.find((p) => p.functionCall)?.functionCall;
  if (call) return { call };

  const text = parts
    .map((p) => p.text ?? "")
    .join("")
    .trim();
  if (text) return { text };

  // An empty candidate means a safety block or a truncated response. Neither is
  // something to paper over with a cheerful non-answer.
  return { error: "I didn't understand that. Send *help* to see what I can do." };
}
