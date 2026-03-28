import OpenAI from "openai";

let _client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!_client) {
    _client = new OpenAI({
      apiKey: process.env.LAVA_API_KEY ?? "placeholder",
      baseURL: process.env.LAVA_BASE_URL ?? "https://gateway.lava.so/v1",
    });
  }
  return _client;
}

export const MODELS: Record<string, string> = {
  "neo-brief": "claude-haiku-4-5-20251001",
  "neo-pr": "groq/llama-3.1-70b-versatile",
  "neo-sched": "claude-sonnet-4-6",
  "neo-root": "claude-sonnet-4-6",
  "neo-sprint": "claude-sonnet-4-6",
  "neo-sprint-notes": "groq/llama-3.1-70b-versatile",
};

export async function lavaChat(
  agentId: string,
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  options?: { temperature?: number; max_tokens?: number }
): Promise<string> {
  const model = MODELS[agentId];
  if (!model) throw new Error(`Unknown agentId: ${agentId}`);

  const response = await getClient().chat.completions.create(
    {
      model,
      messages,
      temperature: options?.temperature ?? 0.3,
      max_tokens: options?.max_tokens ?? 1024,
    },
    {
      headers: {
        "x-lava-agent-id": agentId,
      },
    }
  );

  return response.choices[0]?.message?.content ?? "";
}
