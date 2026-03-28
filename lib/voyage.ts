import axios from "axios";

const VOYAGE_API_URL = "https://api.voyageai.com/v1/embeddings";
const MODEL = "voyage-code-2";

/**
 * Embed a single text string using Voyage AI.
 * Returns a 1536-dimensional embedding vector.
 */
export async function embed(text: string): Promise<number[]> {
  const response = await axios.post(
    VOYAGE_API_URL,
    {
      input: [text],
      model: MODEL,
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
        "Content-Type": "application/json",
      },
    }
  );

  return response.data.data[0].embedding as number[];
}

/**
 * Embed a batch of text strings using Voyage AI.
 * Returns an array of 1536-dimensional embedding vectors.
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const response = await axios.post(
    VOYAGE_API_URL,
    {
      input: texts,
      model: MODEL,
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
        "Content-Type": "application/json",
      },
    }
  );

  return response.data.data.map((item: { embedding: number[] }) => item.embedding);
}
