const EMBEDDING_DIM = 1536;

function hashText(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function deterministicVector(text: string): number[] {
  let seed = hashText(text);
  const out = new Array<number>(EMBEDDING_DIM);
  for (let i = 0; i < EMBEDDING_DIM; i++) {
    seed = (1664525 * seed + 1013904223) >>> 0;
    out[i] = (seed / 0xffffffff) * 2 - 1;
  }
  return out;
}

export async function embed(text: string): Promise<number[]> {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) return deterministicVector(text);

  try {
    const res = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "voyage-3-large",
        input: text,
      }),
    });

    if (!res.ok) {
      return deterministicVector(text);
    }

    const json = await res.json();
    const vector = json?.data?.[0]?.embedding;
    if (!Array.isArray(vector) || vector.length === 0) {
      return deterministicVector(text);
    }
    return vector.map((v: unknown) => Number(v));
  } catch {
    return deterministicVector(text);
  }
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  return Promise.all(texts.map((t) => embed(t)));
}

