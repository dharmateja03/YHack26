import { NextResponse } from "next/server";
import { getDb, COLLECTIONS } from "@/lib/mongodb";
import { lavaChat } from "@/lib/lava";
import { streamSpeech } from "@/lib/elevenlabs";

// ─── POST /api/agents/brief ────────────────────────────────────────────────
// Body: { userId: string, type: "morning" | "evening" }
//
// Reads the user's context from MongoDB (open PRs, P1/P2 tickets, recent Slack
// mentions, today's calendar events), calls Claude Haiku via Lava to write a
// natural-language spoken brief, then either:
//   • Returns { script } JSON  (default)
//   • Streams audio/mpeg       (when Accept: audio/mpeg header is present)
//
// Always writes the generated brief to the `briefs` collection for history.

export async function POST(req: Request): Promise<Response> {
  try {
    const body = await req.json();
    const { userId, type } = body as { userId?: string; type?: string };

    // ── Validate input ────────────────────────────────────────────────────
    if (!userId) {
      return NextResponse.json(
        { error: "userId is required" },
        { status: 400 },
      );
    }

    if (!type || !["morning", "evening"].includes(type)) {
      return NextResponse.json(
        { error: 'type must be "morning" or "evening"' },
        { status: 400 },
      );
    }

    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(now);
    todayEnd.setHours(23, 59, 59, 999);

    const db = await getDb();

    // ── Gather context from MongoDB in parallel ───────────────────────────
    const [prs, tickets, messages, calendars] = await Promise.all([
      // Open PRs assigned to this user
      db
        .collection(COLLECTIONS.prs)
        .find({ assignee: userId, state: "open" })
        .toArray(),

      // P1 and P2 tickets assigned to this user that aren't done
      db
        .collection(COLLECTIONS.tickets)
        .find({
          assignee: userId,
          priority: { $lte: 2 },
          status: { $ne: "Done" },
        })
        .toArray(),

      // Slack messages mentioning this user in the last 24 hours
      db
        .collection(COLLECTIONS.messages)
        .find({
          mentions: userId,
          createdAt: { $gte: yesterday },
        })
        .sort({ createdAt: -1 })
        .limit(20)
        .toArray(),

      // Calendar events happening today
      db
        .collection(COLLECTIONS.calendars)
        .find({
          userId,
          start: { $gte: todayStart, $lte: todayEnd },
        })
        .sort({ start: 1 })
        .toArray(),
    ]);

    // ── Build context block for the prompt ───────────────────────────────
    const prList =
      prs
        .map(
          (p) =>
            `• PR #${p.prId}: "${p.title}" — waiting ${p.waitHours ?? "?"}h for review`,
        )
        .join("\n") || "None";

    const ticketList =
      tickets
        .map(
          (t) => `• [P${t.priority}] ${t.ticketId}: "${t.title}" (${t.status})`,
        )
        .join("\n") || "None";

    const mentionList =
      messages
        .slice(0, 5)
        .map((m) => `• ${m.author}: "${m.text}"`)
        .join("\n") || "None";

    const calendarList =
      calendars
        .map((c) => {
          const start = new Date(c.start).toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
          });
          return `• ${start}: ${c.title}`;
        })
        .join("\n") || "No meetings today";

    const contextBlock = `
Open PRs assigned to you:
${prList}

Your P1/P2 tickets:
${ticketList}

Recent Slack mentions (last 24h):
${mentionList}

Your calendar today:
${calendarList}
    `.trim();

    // ── Build system prompt based on brief type ───────────────────────────
    const systemPrompt =
      type === "morning"
        ? `You are Neo, an AI executive assistant for an engineering team. Write a morning briefing for a software engineer.

Cover these points in order, naturally:
1. Their first meeting today and total meeting count
2. Which open PRs need their review and which is most urgent
3. Any P1 or P2 tickets to be aware of
4. What a teammate might be blocked on that this person can unblock
5. Their single clearest priority for the day

Rules:
- Natural spoken prose only — no bullet points, no headers, no markdown
- Write exactly as if speaking out loud to a colleague
- Maximum 180 words
- Sound knowledgeable and calm, not robotic
- Reference specific PR titles and ticket IDs when available
- End with a single clear action item`
        : `You are Neo, an AI executive assistant for an engineering team. Write an evening wrap-up briefing for a software engineer.

Cover these points in order, naturally:
1. What the team shipped today (merged PRs, closed tickets)
2. What is still open and most at risk of slipping
3. Any new issues or tickets filed today that need attention tomorrow
4. Sprint health — are they on track?
5. What tomorrow looks like (first meeting, key PRs due)

Rules:
- Natural spoken prose only — no bullet points, no headers, no markdown
- Write exactly as if speaking out loud to a colleague
- Maximum 180 words
- Sound knowledgeable and calm, not robotic
- Reference specific PR titles or ticket IDs when available
- End with a single clear action item for tomorrow morning`;

    // ── Call Claude Haiku via Lava ────────────────────────────────────────
    const script = await lavaChat("neo-brief", [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `Here is the current context for this engineer:\n\n${contextBlock}\n\nWrite the ${type} brief now.`,
      },
    ]);

    // ── Persist to briefs collection ──────────────────────────────────────
    await db.collection(COLLECTIONS.briefs).insertOne({
      userId,
      type,
      script,
      contextSnapshot: {
        prCount: prs.length,
        ticketCount: tickets.length,
        mentionCount: messages.length,
        calendarEventCount: calendars.length,
      },
      createdAt: now,
    });

    // ── Log agent run ─────────────────────────────────────────────────────
    await db.collection(COLLECTIONS.agents).insertOne({
      agent: "neo-brief",
      action: `generate-${type}-brief`,
      input: { userId, type },
      output: { wordCount: script.split(/\s+/).length },
      userId,
      durationMs: Date.now() - now.getTime(),
      createdAt: now,
    });

    // ── Return audio stream or JSON ───────────────────────────────────────
    const acceptHeader =
      req.headers.get("Accept") ?? req.headers.get("accept") ?? "";
    if (acceptHeader.includes("audio/mpeg")) {
      const audioStream = await streamSpeech(script);
      return new Response(audioStream, {
        status: 200,
        headers: {
          "Content-Type": "audio/mpeg",
          "Transfer-Encoding": "chunked",
          "Cache-Control": "no-cache",
        },
      });
    }

    return NextResponse.json({ script });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    console.error("[POST /api/agents/brief]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ─── GET /api/agents/brief?userId=xxx ─────────────────────────────────────
// Returns the last 5 briefs generated for the given user, newest first.

export async function GET(req: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get("userId");

    if (!userId) {
      return NextResponse.json(
        { error: "userId query parameter is required" },
        { status: 400 },
      );
    }

    const db = await getDb();

    const briefs = await db
      .collection(COLLECTIONS.briefs)
      .find({ userId })
      .sort({ createdAt: -1 })
      .limit(5)
      .toArray();

    return NextResponse.json({ briefs });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    console.error("[GET /api/agents/brief]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
