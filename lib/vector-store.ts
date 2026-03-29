import { upsertPineconeVectors } from "@/lib/pinecone";

export async function upsertVectorDoc(input: {
  source: string;
  id: string;
  teamId: string;
  text: string;
  embedding: number[];
}) {
  const id = `${input.source}:${input.id}`;
  const text = input.text.slice(0, 2000);

  await upsertPineconeVectors([
    {
      id,
      values: input.embedding,
      metadata: {
        source: input.source,
        docId: input.id,
        teamId: input.teamId || "team-1",
        text,
      },
    },
  ]).catch(() => {
    // best-effort sync
  });
}

