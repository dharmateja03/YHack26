import { COLLECTIONS, getDb } from "@/lib/mongodb";
import { lavaChat } from "@/lib/lava";
import { streamSpeech } from "@/lib/elevenlabs";

type BriefType = "morning" | "evening";

function fallbackScript(type: BriefType): string {
  if (type === "evening") {
    return "Evening brief: you closed key loops today and tomorrow's focus is finishing high-priority PR reviews.";
  }
  return "Morning brief: top priorities are stale pull requests, urgent tickets, and the next blocking meeting decision.";
}

export async function POST(req: Request) {
  const wantsAudio = (req.headers.get("accept") ?? "").includes("audio/mpeg");

  let body: { userId?: string; type?: BriefType };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { userId, type = "morning" } = body;
  if (!userId) {
    return Response.json({ error: "userId required" }, { status: 400 });
  }

  let db: Awaited<ReturnType<typeof getDb>> | null = null;
  let prs: any[] = [];
  let tickets: any[] = [];

  try {
    db = await getDb();
    prs = (await db.collection(COLLECTIONS.prs).find({ state: "open" }).toArray()).slice(0, 5);
    tickets = (await db.collection(COLLECTIONS.tickets).find({}).toArray()).slice(0, 5);
  } catch {
    // Continue without DB context when Mongo is unavailable.
  }

  let script = fallbackScript(type);
  try {
    const ai = await lavaChat("neo-brief", [
      {
        role: "system",
        content:
          "Generate a concise spoken daily engineering brief. Return plain text only, max 120 words.",
      },
      {
        role: "user",
        content:
          `User ${userId}, brief type: ${type}. ` +
          `Open PRs: ${prs.map((p) => p.title).join("; ") || "none"}. ` +
          `Tickets: ${tickets.map((t) => t.summary ?? t.title ?? t.ticketId).join("; ") || "none"}.`,
      },
    ]);
    if (typeof ai === "string" && ai.trim().length > 0) {
      script = ai.trim();
    }
  } catch {
    // Use deterministic fallback text when AI is unavailable.
  }

  if (db) {
    try {
      await db.collection(COLLECTIONS.briefs).insertOne({
        userId,
        type,
        script,
        createdAt: new Date(),
      });
    } catch {
      // Writing history should not fail the brief response.
    }
  }

  if (wantsAudio) {
    const audioStream = await streamSpeech(script);
    return new Response(audioStream, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  }

  return Response.json({ script });
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get("userId");
  if (!userId) {
    return Response.json({ error: "userId required" }, { status: 400 });
  }

  let briefs: any[] = [];
  try {
    const db = await getDb();
    briefs = await db
      .collection(COLLECTIONS.briefs)
      .find({ userId })
      .toArray();
  } catch {
    return Response.json({ briefs: [] });
  }

  const sorted = briefs
    .sort(
      (a, b) =>
        new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime()
    )
    .slice(0, 5)
    .map((b) => ({
      type: b.type ?? "morning",
      script: b.script ?? "",
      createdAt: b.createdAt ?? null,
    }));

  return Response.json({ briefs: sorted });
}
