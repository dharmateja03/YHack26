type PineconeVector = {
  id: string;
  values: number[];
  metadata?: Record<string, string | number | boolean>;
};

interface PineconeQueryMatch {
  id: string;
  score?: number;
  metadata?: Record<string, any>;
}

function getPineconeHost(): string | null {
  const host = process.env.PINECONE_INDEX_HOST?.trim();
  if (!host) return null;
  return host.startsWith("http://") || host.startsWith("https://") ? host : `https://${host}`;
}

function getHeaders(): Record<string, string> {
  return {
    "Api-Key": process.env.PINECONE_API_KEY?.trim() || "",
    "Content-Type": "application/json",
  };
}

export function isPineconeConfigured(): boolean {
  return Boolean(process.env.PINECONE_API_KEY?.trim() && getPineconeHost());
}

export async function upsertPineconeVectors(
  vectors: PineconeVector[],
  namespace?: string
): Promise<void> {
  if (!isPineconeConfigured() || vectors.length === 0) return;
  const host = getPineconeHost();
  if (!host) return;

  await fetch(`${host}/vectors/upsert`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({
      vectors,
      namespace: namespace || process.env.PINECONE_NAMESPACE || "neosis",
    }),
  });
}

export async function queryPineconeByVector(input: {
  vector: number[];
  topK?: number;
  filter?: Record<string, any>;
  namespace?: string;
}): Promise<PineconeQueryMatch[]> {
  if (!isPineconeConfigured()) return [];
  const host = getPineconeHost();
  if (!host) return [];

  const res = await fetch(`${host}/query`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({
      vector: input.vector,
      topK: input.topK ?? 10,
      includeMetadata: true,
      filter: input.filter,
      namespace: input.namespace || process.env.PINECONE_NAMESPACE || "neosis",
    }),
  });

  if (!res.ok) return [];
  const data = (await res.json()) as { matches?: PineconeQueryMatch[] };
  return data.matches ?? [];
}

