import "server-only";
import { TOOL_DECLARATIONS, type ToolArgs } from "./tools";

const MODEL = process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash-lite";
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

function apiKey() {
  const key = (process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY)?.trim();
  return key && !/^(replace|your|xxx|placeholder|change[-_]me|todo)/i.test(key) ? key : null;
}

export function geminiConfigured() { return apiKey() !== null; }

type FunctionCall = { name?: unknown; args?: unknown };
export type GeminiSelection = { name: string; args: ToolArgs } | null;

// The model is a classifier/extractor, not a conversational authority. Its
// output is accepted only as one of these function calls; the tool returns all
// user-facing ERP facts and validates every supplied argument.
export async function selectTool(message: string): Promise<GeminiSelection> {
  const key = apiKey();
  if (!key) return null;
  const body = {
    systemInstruction: {
      parts: [{ text: [
        "Choose exactly one ERP assistant function for the incoming WhatsApp message.",
        "Never answer the user in text. Never create, alter, infer or execute SQL.",
        "Use only existing names stated by the user; tools resolve names and ask when ambiguous.",
        "Write tools only create a draft. They are never saved until a separate exact yes message.",
        "Dates passed to a tool must be YYYY-MM-DD. Amounts are Pakistani Rupees.",
        "Use unsupported_request if no listed function fits.",
      ].join("\n") }],
    },
    contents: [{ role: "user", parts: [{ text: message }] }],
    tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
    toolConfig: { functionCallingConfig: { mode: "ANY", allowedFunctionNames: TOOL_DECLARATIONS.map((tool) => tool.name) } },
    generationConfig: { temperature: 0, maxOutputTokens: 512 },
  };
  let response: Response;
  try {
    response = await fetch(`${ENDPOINT}/${encodeURIComponent(MODEL)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    console.error("[whatsapp-agent] Gemini request failed", error instanceof Error ? error.message : "unknown");
    return null;
  }
  if (!response.ok) {
    console.error("[whatsapp-agent] Gemini response", response.status);
    return null;
  }
  const data = await response.json().catch(() => null) as { candidates?: { content?: { parts?: { functionCall?: FunctionCall }[] } }[] } | null;
  const call = data?.candidates?.[0]?.content?.parts?.find((part) => part.functionCall)?.functionCall;
  if (!call || typeof call.name !== "string" || !call.name) return null;
  return { name: call.name, args: call.args && typeof call.args === "object" && !Array.isArray(call.args) ? call.args as ToolArgs : {} };
}
