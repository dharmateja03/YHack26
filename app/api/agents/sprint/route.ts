import { COLLECTIONS, getDb } from "@/lib/mongodb";
import { lavaChat } from "@/lib/lava";

export async function POST(req: Request) {
  const pathname = new URL(req.url).pathname;

  if (pathname.endsWith("/forecast")) return handleForecast(req);
  if (pathname.endsWith("/release-notes")) return handleReleaseNotes(req);

  return Response.json({ error: "Unknown action" }, { status: 404 });
}

async function handleForecast(req: Request) {
  let body: { teamId?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.teamId) {
    return Response.json({ error: "teamId required" }, { status: 400 });
  }

  const db = await getDb();
  const openPrs = await db
    .collection(COLLECTIONS.prs)
    .find({ teamId: body.teamId, state: "open" })
    .toArray();
  const tickets = await db.collection(COLLECTIONS.tickets).find({ teamId: body.teamId }).toArray();

  const blockedCount = openPrs.filter((pr) => pr.checks !== "success").length;
  let onTrack = blockedCount <= Math.ceil(openPrs.length / 2);

  let recommendation = onTrack
    ? "Keep current sprint scope and close review loops quickly."
    : "Reduce scope and resolve top blocker before adding new work.";
  let bottleneck = blockedCount > 0 ? "PR review/check bottleneck" : "No critical bottleneck detected";

  try {
    const ai = await lavaChat("neo-sprint", [
      {
        role: "system",
        content:
          'Return JSON only: {"onTrack": boolean, "recommendation": string, "bottleneck": string}',
      },
      {
        role: "user",
        content: `Open PRs: ${openPrs.length}, blocked PRs: ${blockedCount}, tickets: ${tickets.length}`,
      },
    ]);
    const parsed = JSON.parse(ai);
    if (typeof parsed.onTrack === "boolean") onTrack = parsed.onTrack;
    if (typeof parsed.recommendation === "string" && parsed.recommendation.trim()) {
      recommendation = parsed.recommendation.trim();
    }
    if (typeof parsed.bottleneck === "string" && parsed.bottleneck.trim()) {
      bottleneck = parsed.bottleneck.trim();
    }
  } catch {
    // Keep deterministic fallback output.
  }

  return Response.json({ onTrack, recommendation, bottleneck });
}

async function handleReleaseNotes(req: Request) {
  let body: { teamId?: string; sprintId?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.teamId || !body.sprintId) {
    return Response.json({ error: "teamId and sprintId required" }, { status: 400 });
  }

  const db = await getDb();
  const prs = await db
    .collection(COLLECTIONS.prs)
    .find({ teamId: body.teamId })
    .toArray();

  const mergedTitles = prs
    .filter((pr) => pr.state !== "open")
    .map((pr) => pr.title)
    .slice(0, 6);

  let internal = `Sprint ${body.sprintId} internal summary: ${mergedTitles.join("; ") || "no merged changes"}.`;
  let external = `Sprint ${body.sprintId} release notes: quality and reliability improvements shipped.`;

  try {
    const ai = await lavaChat("neo-sprint-notes", [
      {
        role: "system",
        content: 'Return JSON only: {"internal": string, "external": string}',
      },
      {
        role: "user",
        content:
          `Team: ${body.teamId}, sprint: ${body.sprintId}, merged work: ${mergedTitles.join("; ") || "none"}`,
      },
    ]);
    const parsed = JSON.parse(ai);
    if (typeof parsed.internal === "string" && parsed.internal.trim()) {
      internal = parsed.internal.trim();
    }
    if (typeof parsed.external === "string" && parsed.external.trim()) {
      external = parsed.external.trim();
    }
  } catch {
    // Keep deterministic fallback output.
  }

  return Response.json({ internal, external });
}
