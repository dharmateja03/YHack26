import OpenAI from "openai";

// ─── Model routing table ───────────────────────────────────────────────────
// Every LLM call goes through Lava Gateway — never call Claude or Groq directly.
// x-lava-agent-id is injected per-request so Lava tracks spend per agent.

export const MODELS: Record<string, string> = {
  "neo-brief":        "claude-haiku-4-5-20251001",       // fast + cheap, 300 tokens max
  "neo-pr":           "groq/llama-3.1-70b-versatile",    // simple generation, 10x cheaper
  "neo-sched":        "claude-sonnet-4-6",               // multi-step calendar reasoning
  "neo-root":         "claude-sonnet-4-6",               // deep reasoning over evidence
  "neo-sprint":       "claude-sonnet-4-6",               // sprint forecast reasoning
  "neo-sprint-notes": "groq/llama-3.1-70b-versatile",   // structured templated output
};

// ─── Lava client (OpenAI-compatible) ──────────────────────────────────────
// Lava is OpenAI-compatible — point the openai SDK at the Lava base URL.

const lavaClient = new OpenAI({
  apiKey: process.env.LAVA_API_KEY ?? "",
  baseURL: process.env.LAVA_BASE_URL ?? "https://gateway.lava.so/v1",
});

// ─── Message type ──────────────────────────────────────────────────────────

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

// ─── lavaChat ──────────────────────────────────────────────────────────────
// Sends a chat completion request to Lava and returns the assistant reply.
// Automatically injects the x-lava-agent-id header so per-agent spend is
// tracked separately in the Lava dashboard.

export async function lavaChat(
  agentId: string,
  messages: ChatMessage[]
): Promise<string> {
  const model = MODELS[agentId];

  if (!model) {
    throw new Error(
      `[lava] Unknown agent ID: "${agentId}". Valid IDs: ${Object.keys(MODELS).join(", ")}`
    );
  }

  const response = await lavaClient.chat.completions.create(
    {
      model,
      messages,
    },
    {
      headers: {
        "x-lava-agent-id": agentId,
      },
    }
  );

  const content = response.choices[0]?.message?.content;

  if (!content) {
    throw new Error(`[lava] Empty response from model "${model}" for agent "${agentId}"`);
  }

  return content;
}
