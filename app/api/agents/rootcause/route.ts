import { COLLECTIONS, getDb } from "@/lib/mongodb";
import { lavaChat } from "@/lib/lava";
import { embed } from "@/lib/voyage";
import { resolveTeamAwareness } from "@/lib/agent-context";
import { isPineconeConfigured, queryPineconeByVector } from "@/lib/pinecone";

type EvidenceItem = {
  source: string;
  id: string;
  text: string;
};

async function vectorSearch(
  db: any,
  collectionName: string,
  indexName: string,
  queryVector: number[],
  teamId: string
): Promise<{ source: string; id: string; text: string; score: number }[]> {
  if (isPineconeConfigured()) {
    try {
      const matches = await queryPineconeByVector({
        vector: queryVector,
        topK: 12,
        filter: {
          teamId: { $eq: teamId },
          source: { $eq: collectionName },
        },
      });

      return matches
        .filter((m) => Number(m.score ?? 0) >= 0.7)
        .map((m) => ({
          source: String(m.metadata?.source ?? collectionName),
          id: String(m.metadata?.docId ?? m.id),
          text: String(m.metadata?.text ?? ""),
          score: Number(m.score ?? 0),
        }));
    } catch {
      // fall through to Mongo vector search fallback
    }
  }

  try {
    const results = await db
      .collection(collectionName)
      .aggregate([
        {
          $vectorSearch: {
            index: indexName,
            path: "embedding",
            queryVector,
            numCandidates: 50,
            limit: 10,
            filter: { teamId },
          },
        },
        { $addFields: { score: { $meta: "vectorSearchScore" } } },
        { $match: { score: { $gte: 0.7 } } },
      ])
      .toArray();

    return results.map((r: any) => ({
      source: collectionName,
      id: String(r.messageId ?? r.prId ?? r.ticketId ?? r._id),
      text: String(r.text ?? r.title ?? r.description ?? ""),
      score: r.score,
    }));
  } catch {
    // Fallback: if vector search is unavailable, return empty
    return [];
  }
}

export async function POST(req: Request) {
  let body: { prId?: string; ticketId?: string; teamId?: string; userId?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.prId && !body.ticketId) {
    return Response.json({ error: "prId or ticketId required" }, { status: 400 });
  }

  const db = await getDb();

  // Step 1: Get the target PR or ticket
  let target: any = null;
  if (body.prId) {
    target = await db.collection(COLLECTIONS.prs).findOne({ prId: body.prId });
  } else if (body.ticketId) {
    target = await db.collection(COLLECTIONS.tickets).findOne({ ticketId: body.ticketId });
  }

  const teamCtx = await resolveTeamAwareness({
    userId: body.userId,
    teamId: body.teamId,
    fallbackTeamId: "team-1",
  });
  const teamId = target?.teamId ?? teamCtx.teamId;
  const queryText = target
    ? `${target.title ?? ""} ${target.description ?? target.body ?? ""}`
    : (body.prId ?? body.ticketId ?? "");

  // Step 2: Embed the title + description
  const queryVector = await embed(queryText);

  // Step 3: Run Atlas Vector Search across messages, tickets, prs
  const [msgResults, ticketResults, prResults] = await Promise.all([
    vectorSearch(db, COLLECTIONS.messages, "messages_vector", queryVector, teamId),
    vectorSearch(db, COLLECTIONS.tickets, "tickets_vector", queryVector, teamId),
    vectorSearch(db, COLLECTIONS.prs, "prs_vector", queryVector, teamId),
  ]);

  const allEvidence = [...msgResults, ...ticketResults, ...prResults]
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  const bestScore = allEvidence[0]?.score ?? 0;

  // Step 4: If best similarity < 0.7, return partial evidence
  if (bestScore < 0.7 || allEvidence.length === 0) {
    const partial: EvidenceItem[] = allEvidence.map((e) => ({
      source: e.source,
      id: e.id,
      text: e.text,
    }));

    const result = {
      cause: "Insufficient high-similarity evidence to determine a root cause confidently.",
      blockedBy: "unknown",
      recommendedAction: "Collect more context from PR comments and ticket updates.",
      evidence: partial,
      confident: false,
    };

    await db.collection(COLLECTIONS.agents).insertOne({
      agent: "neo-root",
      action: "rootcause",
      input: body,
      output: result,
      teamId,
      createdAt: new Date(),
    });

    return Response.json(result);
  }

  // Step 5: Call lavaChat with all retrieved context
  const contextBlock = allEvidence
    .map((e) => `[${e.source}:${e.id}] ${e.text}`)
    .join("\n");

  const llmResponse = await lavaChat("neo-root", [
    {
      role: "system",
      content:
        "You are a root cause analyst for an engineering team. Given evidence from Slack messages, Jira tickets, and GitHub PRs, determine the root cause of a delay or blocker. Cite every source by its ID. Respond in JSON with fields: cause, blockedBy, recommendedAction, evidence (array of {source, id, text}).\n" +
        `Team context:\n${teamCtx.orgSummary}`,
    },
    {
      role: "user",
      content: `Analyze why this is blocked:\nTarget: ${queryText}\n\nEvidence:\n${contextBlock}\n\nRespond in JSON.`,
    },
  ]);

  let parsed: any;
  try {
    parsed = JSON.parse(llmResponse);
  } catch {
    parsed = {
      cause: llmResponse,
      blockedBy: "unknown",
      recommendedAction: "Review the evidence manually.",
      evidence: allEvidence.map((e) => ({ source: e.source, id: e.id, text: e.text })),
    };
  }

  const evidence: EvidenceItem[] = Array.isArray(parsed.evidence)
    ? parsed.evidence.map((e: any) => ({
        source: String(e.source ?? "unknown"),
        id: String(e.id ?? ""),
        text: String(e.text ?? ""),
      }))
    : allEvidence.map((e) => ({ source: e.source, id: e.id, text: e.text }));

  const result = {
    cause: String(parsed.cause ?? ""),
    blockedBy: String(parsed.blockedBy ?? "unknown"),
    recommendedAction: String(parsed.recommendedAction ?? ""),
    evidence,
    confident: true,
  };

  await db.collection(COLLECTIONS.agents).insertOne({
    agent: "neo-root",
    action: "rootcause",
    input: body,
    output: result,
    teamId,
    createdAt: new Date(),
  });

  return Response.json(result);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const teamCtx = await resolveTeamAwareness({
    teamId: searchParams.get("teamId") ?? undefined,
    fallbackTeamId: "team-1",
  });
  const teamId = teamCtx.teamId;

  const db = await getDb();
  const rows = await db
    .collection(COLLECTIONS.agents)
    .find({ agent: "neo-root", teamId })
    .toArray();

  const history = rows
    .sort(
      (a: any, b: any) =>
        new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime()
    )
    .slice(0, 20)
    .map((r: any) => ({
      createdAt: r.createdAt ?? null,
      input: r.input ?? {},
      result: r.output ?? {},
    }));

  return Response.json({ history });
}
