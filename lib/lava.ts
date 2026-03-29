import OpenAI from "openai";

let _client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!_client) {
    _client = new OpenAI({
      apiKey: process.env.LAVA_API_KEY ?? "placeholder",
      baseURL: process.env.LAVA_BASE_URL ?? "https://api.lava.so/v1",
    });
  }
  return _client;
}

export const MODELS: Record<string, string> = {
  "neo-chat": "gpt-5-chat-latest",
  "neo-brief": "gpt-5-chat-latest",
  "neo-pr": "gpt-5-chat-latest",
  "neo-sched": "gpt-5-chat-latest",
  "neo-root": "gpt-5-chat-latest",
  "neo-sprint": "gpt-5-chat-latest",
  "neo-sprint-notes": "gpt-5-chat-latest",
  "neo-hermes": "gpt-5-chat-latest",
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
