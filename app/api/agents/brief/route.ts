import { COLLECTIONS, getDb } from "@/lib/mongodb";
import { lavaChat } from "@/lib/lava";
import { streamSpeech } from "@/lib/elevenlabs";
import { resolveTeamAwareness } from "@/lib/agent-context";
import { getSqliteDbSafe } from "@/lib/sqlite";
import { getOrgContextForUser } from "@/lib/org";

type BriefType = "morning" | "evening";

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs)
    ),
  ]);
}

function fallbackScript(type: BriefType, isManager = false): string {
  if (type === "evening") {
    return isManager
      ? "Evening brief: your team closed key loops today. Review blocked tickets and prep tomorrow's stand-up."
      : "Evening brief: you closed key loops today and tomorrow's focus is finishing high-priority PR reviews.";
  }
  return isManager
    ? "Morning brief: top team priorities are stale pull requests, escalated blockers, and sprint risk."
    : "Morning brief: top priorities are stale pull requests, urgent tickets, and the next blocking meeting decision.";
}

// ── Slack delivery ────────────────────────────────────────────────────────────

async function deliverToSlack(script: string, channel: string): Promise<void> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return;
  await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      channel,
      text: `*Neo Brief*\n${script}`,
    }),
  }).catch(() => {});
}

// ── Email delivery via Nylas ──────────────────────────────────────────────────

async function deliverToEmail(script: string, toEmail: string): Promise<void> {
  const apiKey = process.env.NYLAS_API_KEY;
  if (!apiKey || !toEmail) return;
  await fetch("https://api.nylas.com/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to: [{ email: toEmail }],
      subject: "Your Neo Brief",
      body: script,
    }),
  }).catch(() => {});
}

// ── Calendar: first event of today ───────────────────────────────────────────

async function getFirstMeetingToday(userId: string): Promise<string | null> {
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);

  try {
    const db = await getDb();
    const events = await db
      .collection(COLLECTIONS.calendars)
      .find({ userId, start: { $gte: startOfDay.toISOString(), $lte: endOfDay.toISOString() } })
      .sort({ start: 1 })
      .limit(1)
      .toArray();

    if (events.length > 0) {
      const evt = events[0];
      const start = new Date(evt.start);
      return `${start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} (${evt.title ?? "meeting"})`;
    }
  } catch {
    // No calendar data available.
  }
  return null;
}

// ── Delta detection: what changed since last brief ────────────────────────────

interface BriefSnapshot {
  prIds: string[];
  ticketStates: Record<string, string>;
}

function buildSnapshot(prs: any[], tickets: any[]): BriefSnapshot {
  return {
    prIds: prs.map((p) => p.prId ?? p.pr_id ?? ""),
    ticketStates: Object.fromEntries(
      tickets.map((t) => [t.ticketId ?? t.ticket_id ?? "", t.status ?? t.state ?? ""])
    ),
  };
}

function computeDelta(
  current: BriefSnapshot,
  previous: BriefSnapshot | null,
  prs: any[],
  tickets: any[]
): { newPrIds: string[]; changedTicketIds: string[]; hasChanges: boolean } {
  if (!previous) {
    return { newPrIds: current.prIds, changedTicketIds: Object.keys(current.ticketStates), hasChanges: true };
  }
  const prevPrSet = new Set(previous.prIds);
  const newPrIds = current.prIds.filter((id) => !prevPrSet.has(id));

  const changedTicketIds = Object.entries(current.ticketStates)
    .filter(([id, state]) => previous.ticketStates[id] !== state)
    .map(([id]) => id);

  return { newPrIds, changedTicketIds, hasChanges: newPrIds.length > 0 || changedTicketIds.length > 0 };
}

// ── Main route ────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const wantsAudio = (req.headers.get("accept") ?? "").includes("audio/mpeg");

  let body: {
    userId?: string;
    type?: BriefType;
    deltaOnly?: boolean;
    delivery?: ("slack" | "email")[];
    slackChannel?: string;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { userId, type = "morning", deltaOnly = false, delivery = [], slackChannel } = body;
  const teamCtx = await resolveTeamAwareness({ userId, fallbackUserId: "user-1" });
  const resolvedUserId = teamCtx.userId;

  // Determine caller role for personalization
  let isManager = false;
  let callerEmail: string | undefined;
  try {
    const orgCtx = await getOrgContextForUser(resolvedUserId);
    isManager = orgCtx?.me?.role === "manager";
    callerEmail = orgCtx?.me?.workEmail ?? orgCtx?.me?.email;
  } catch {
    // Best-effort.
  }

  // ── Fetch live data (priority-sorted) ──────────────────────────────────────
  let db: Awaited<ReturnType<typeof getDb>> | null = null;
  let prs: any[] = [];
  let tickets: any[] = [];
  let sprints: any[] = [];

  try {
    db = await getDb();

    // Manager sees all team data; member sees assigned items first
    const prFilter = isManager
      ? { state: "open" }
      : { state: "open", $or: [{ author: resolvedUserId }, { assignee: resolvedUserId }] };
    const ticketFilter = isManager ? {} : { assignee: resolvedUserId };

    const rawPrs = await db.collection(COLLECTIONS.prs).find(prFilter).toArray();
    const rawTickets = await db.collection(COLLECTIONS.tickets).find(ticketFilter).toArray();

    // Priority-first: PRs stale (low approvals) first, then by approval ratio
    prs = rawPrs
      .sort((a, b) => {
        const aStale = (a.approvals ?? 0) < (a.requiredApprovals ?? 1) ? 0 : 1;
        const bStale = (b.approvals ?? 0) < (b.requiredApprovals ?? 1) ? 0 : 1;
        if (aStale !== bStale) return aStale - bStale;
        return (a.approvals ?? 0) - (b.approvals ?? 0);
      })
      .slice(0, isManager ? 8 : 5);

    // Priority-first: tickets by priority number (lower = higher priority), blocked first
    tickets = rawTickets
      .sort((a, b) => {
        const aBlocked = (a.blockedBy?.length ?? 0) > 0 ? 0 : 1;
        const bBlocked = (b.blockedBy?.length ?? 0) > 0 ? 0 : 1;
        if (aBlocked !== bBlocked) return aBlocked - bBlocked;
        return (a.priority ?? 3) - (b.priority ?? 3);
      })
      .slice(0, isManager ? 8 : 5);

    sprints = isManager
      ? await db.collection(COLLECTIONS.sprints).find({}).limit(1).toArray()
      : [];
  } catch {
    const sqlite = await getSqliteDbSafe();
    if (sqlite) {
      const prRows = sqlite
        .prepare(
          isManager
            ? "SELECT pr_id AS prId, title, body, approvals, required_approvals AS requiredApprovals FROM prs WHERE state = 'open' ORDER BY approvals ASC LIMIT 8"
            : "SELECT pr_id AS prId, title, body, approvals, required_approvals AS requiredApprovals FROM prs WHERE state = 'open' ORDER BY approvals ASC LIMIT 5"
        )
        .all();
      const ticketRows = sqlite
        .prepare(
          isManager
            ? "SELECT ticket_id AS ticketId, title, description, priority, status, blocked_by_json AS blockedByJson FROM tickets ORDER BY priority ASC LIMIT 8"
            : "SELECT ticket_id AS ticketId, title, description, priority, status, blocked_by_json AS blockedByJson FROM tickets ORDER BY priority ASC LIMIT 5"
        )
        .all() as any[];
      prs = prRows;
      tickets = ticketRows.map((t) => ({
        ...t,
        blockedBy: (() => { try { return JSON.parse(t.blockedByJson ?? "[]"); } catch { return []; } })(),
      }));
    }
  }

  // ── Calendar-aware timing ──────────────────────────────────────────────────
  const firstMeeting = await getFirstMeetingToday(resolvedUserId);

  // ── Delta detection ────────────────────────────────────────────────────────
  let previousSnapshot: BriefSnapshot | null = null;
  let lastBriefAt: Date | null = null;
  if (db) {
    try {
      const lastBriefs = await db
        .collection(COLLECTIONS.briefs)
        .find({ userId: resolvedUserId })
        .sort({ createdAt: -1 })
        .limit(1)
        .toArray();
      if (lastBriefs.length > 0) {
        previousSnapshot = lastBriefs[0].snapshot ?? null;
        lastBriefAt = lastBriefs[0].createdAt ? new Date(lastBriefs[0].createdAt) : null;
      }
    } catch {
      // Best-effort.
    }
  }

  const currentSnapshot = buildSnapshot(prs, tickets);
  const delta = computeDelta(currentSnapshot, previousSnapshot, prs, tickets);

  // If delta mode is requested and nothing changed, return early
  if (deltaOnly && !delta.hasChanges && previousSnapshot) {
    const noChangeMsg = "No changes since your last brief — you're all caught up.";
    return Response.json({ script: noChangeMsg, deltaOnly: true, hasChanges: false });
  }

  // When delta mode: filter to only changed items
  const briefPrs = deltaOnly && previousSnapshot
    ? prs.filter((p) => delta.newPrIds.includes(p.prId ?? p.pr_id ?? ""))
    : prs;
  const briefTickets = deltaOnly && previousSnapshot
    ? tickets.filter((t) => delta.changedTicketIds.includes(t.ticketId ?? t.ticket_id ?? ""))
    : tickets;

  // ── LLM script generation ──────────────────────────────────────────────────
  const sprintSummary = sprints.length > 0
    ? `Sprint "${sprints[0].name}": ${sprints[0].stories?.filter((s: any) => s.status === "done").length ?? 0}/${sprints[0].stories?.length ?? 0} done, velocity ${sprints[0].velocity ?? "unknown"}.`
    : "";

  const blockedTickets = briefTickets.filter((t) => (t.blockedBy?.length ?? 0) > 0);
  const calendarHint = firstMeeting ? `First meeting: ${firstMeeting}.` : "";
  const deltaHint = deltaOnly && previousSnapshot && lastBriefAt
    ? `Only include items changed since ${lastBriefAt.toLocaleString()}.`
    : "";
  const roleHint = isManager
    ? "This user is a MANAGER — include team-wide blockers, sprint risk, and highlight who is blocked."
    : "This user is a TEAM MEMBER — focus on their assigned work and immediate blockers.";

  let script = fallbackScript(type, isManager);
  try {
    const ai = await withTimeout(
      lavaChat("neo-brief", [
        {
          role: "system",
          content: [
            "Generate a concise spoken daily engineering brief. Return plain text only, max 120 words.",
            roleHint,
            deltaHint,
          ]
            .filter(Boolean)
            .join(" "),
        },
        {
          role: "user",
          content: [
            `User ${resolvedUserId}, brief type: ${type}.`,
            calendarHint,
            `Team context:\n${teamCtx.orgSummary}`,
            `Open PRs (priority order): ${briefPrs.map((p) => p.title).join("; ") || "none"}.`,
            `Tickets (priority/blocked first): ${briefTickets.map((t) => `${t.summary ?? t.title ?? t.ticketId}${(t.blockedBy?.length ?? 0) > 0 ? " [BLOCKED]" : ""} P${t.priority ?? "?"}${t.status ? ` (${t.status})` : ""}`).join("; ") || "none"}.`,
            blockedTickets.length > 0 ? `BLOCKED: ${blockedTickets.map((t) => t.title ?? t.ticketId).join(", ")}.` : "",
            sprintSummary,
          ]
            .filter(Boolean)
            .join(" "),
        },
      ]),
      12000
    );
    if (typeof ai === "string" && ai.trim().length > 0) {
      script = ai.trim();
    }
  } catch {
    // Use deterministic fallback text when AI is unavailable.
  }

  // ── Persist brief with snapshot ────────────────────────────────────────────
  if (db) {
    try {
      await db.collection(COLLECTIONS.briefs).insertOne({
        userId: resolvedUserId,
        type,
        script,
        snapshot: currentSnapshot,
        isManager,
        deltaOnly,
        createdAt: new Date(),
      });
    } catch {
      // Writing history should not fail the brief response.
    }
  }

  // ── Async delivery (Slack / email) ─────────────────────────────────────────
  if (delivery.includes("slack") && slackChannel) {
    void deliverToSlack(script, slackChannel).catch(() => {});
  }
  if (delivery.includes("email") && callerEmail) {
    void deliverToEmail(script, callerEmail).catch(() => {});
  }

  // ── Return audio or JSON ───────────────────────────────────────────────────
  if (wantsAudio) {
    try {
      const audioStream = await withTimeout(streamSpeech(script), 15000);
      return new Response(audioStream, {
        headers: {
          "Content-Type": "audio/mpeg",
          "Cache-Control": "no-store",
        },
      });
    } catch (error) {
      console.error("[brief POST] TTS failed:", error);
      return Response.json(
        { script, mode: "text-fallback" },
        { headers: { "Cache-Control": "no-store" } }
      );
    }
  }

  return Response.json({
    script,
    isManager,
    deltaOnly,
    hasChanges: delta.hasChanges,
    firstMeeting,
  });
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const userIdParam = searchParams.get("userId") ?? undefined;
  const teamCtx = await resolveTeamAwareness({ userId: userIdParam, fallbackUserId: "user-1" });
  const userId = teamCtx.userId;

  let briefs: any[] = [];
  try {
    const db = await getDb();
    briefs = await db
      .collection(COLLECTIONS.briefs)
      .find({ userId })
      .sort({ createdAt: -1 })
      .limit(5)
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
      isManager: b.isManager ?? false,
      deltaOnly: b.deltaOnly ?? false,
      hasChanges: b.hasChanges,
    }));

  return Response.json({ briefs: sorted });
}
