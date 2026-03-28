import { COLLECTIONS, getDb } from "@/lib/mongodb";
import { embed } from "@/lib/voyage";

type EvidenceItem = {
  source: string;
  id: string;
  text: string;
};

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function evidenceFromMessages(messages: any[]): EvidenceItem[] {
  return messages.slice(0, 3).map((m, idx) => ({
    source: "slack",
    id: String(m.id ?? m.messageId ?? m.ts ?? `msg-${idx + 1}`),
    text: String(m.text ?? ""),
  }));
}

export async function POST(req: Request) {
  let body: { prId?: string; ticketId?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.prId && !body.ticketId) {
    return Response.json({ error: "prId or ticketId required" }, { status: 400 });
  }

  const db = await getDb();
  const queryId = body.prId ?? body.ticketId ?? "";
  const queryVector = await embed(queryId);

  const messages = await db.collection(COLLECTIONS.messages).find({}).toArray();
  const scored = await Promise.all(
    messages.map(async (m) => {
      const text = `${m.text ?? ""} ${m.channel ?? ""} ${m.user ?? ""}`.trim();
      const vector = await embed(text || "empty");
      return { message: m, similarity: cosineSimilarity(queryVector, vector) };
    })
  );

  scored.sort((a, b) => b.similarity - a.similarity);
  const top = scored.slice(0, 3);
  const best = top[0]?.similarity ?? 0;
  const confident = best >= 0.7 && top.length > 0;
  const evidence = confident ? evidenceFromMessages(top.map((t) => t.message)) : [];

  const cause = confident
    ? "Likely blocked by unresolved dependency discussed in team messages."
    : "Insufficient high-similarity evidence to determine a root cause confidently.";
  const blockedBy = confident ? "Cross-team review/dependency wait" : "unknown";
  const recommendedAction = confident
    ? "Escalate to owner and schedule a 15-minute unblock sync."
    : "Collect more context from PR comments and ticket updates.";

  await db.collection(COLLECTIONS.agents).insertOne({
    agent: "neo-root",
    action: "rootcause",
    input: body,
    output: { cause, blockedBy, recommendedAction, evidence, confident },
    teamId: "team-1",
    createdAt: new Date(),
  });

  return Response.json({ cause, blockedBy, recommendedAction, evidence, confident });
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const teamId = searchParams.get("teamId");
  if (!teamId) return Response.json({ error: "teamId required" }, { status: 400 });

  const db = await getDb();
  const rows = await db
    .collection(COLLECTIONS.agents)
    .find({ agent: "neo-root", teamId })
    .toArray();

  const history = rows
    .sort(
      (a, b) =>
        new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime()
    )
    .slice(0, 20)
    .map((r) => ({
      createdAt: r.createdAt ?? null,
      input: r.input ?? {},
      result: r.output ?? {},
    }));

  return Response.json({ history });
}

