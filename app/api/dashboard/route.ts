import { NextRequest, NextResponse } from "next/server";
import { COLLECTIONS, getDb } from "@/lib/mongodb";
import { getSessionUser } from "@/lib/current-user";
import { getOrgContextForUser } from "@/lib/org";
import { getSqliteDbSafe } from "@/lib/sqlite";

const STALE_PR_HOURS = 48;

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  const userId = user?.userId ?? (new URL(req.url).searchParams.get("userId") ?? "user-1");

  // Resolve org context for team-wide view
  let orgId = "org-1";
  let teamId = "team-1";
  let memberNames: Record<string, string> = {};

  try {
    const orgCtx = await getOrgContextForUser(userId);
    if (orgCtx) {
      orgId = orgCtx.org.orgId;
      teamId = orgCtx.org.slug || orgId;
      for (const m of orgCtx.members) {
        memberNames[m.userId] = m.name ?? m.userId;
      }
    }
  } catch {
    // Best-effort.
  }

  const staleThreshold = new Date(Date.now() - STALE_PR_HOURS * 60 * 60 * 1000).toISOString();
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay()); // Sunday
  weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);

  try {
    const db = await getDb();

    const [rawPrs, rawTickets, rawSprints, rawCalendars] = await Promise.all([
      db.collection(COLLECTIONS.prs).find({ state: "open" }).toArray(),
      db.collection(COLLECTIONS.tickets).find({}).toArray(),
      db.collection(COLLECTIONS.sprints).find({}).limit(3).toArray(),
      db.collection(COLLECTIONS.calendars).find({
        start: { $gte: weekStart.toISOString(), $lte: weekEnd.toISOString() },
      }).toArray(),
    ]);

    return NextResponse.json(buildDashboard({
      rawPrs, rawTickets, rawSprints, rawCalendars,
      staleThreshold, weekStart, weekEnd, memberNames,
    }));
  } catch {
    // Fallback to SQLite
    try {
      const sqlite = await getSqliteDbSafe();
      if (!sqlite) {
        return NextResponse.json(emptyDashboard());
      }

      const rawPrs = sqlite
        .prepare("SELECT pr_id AS prId, title, author, approvals, required_approvals AS requiredApprovals, created_at AS createdAt, updated_at AS updatedAt FROM prs WHERE state = 'open'")
        .all();
      const rawTickets = sqlite
        .prepare("SELECT ticket_id AS ticketId, title, priority, status, assignee, blocked_by_json AS blockedByJson FROM tickets")
        .all() as any[];
      const tickets = rawTickets.map((t) => ({
        ...t,
        blockedBy: (() => { try { return JSON.parse(t.blockedByJson ?? "[]"); } catch { return []; } })(),
      }));

      return NextResponse.json(buildDashboard({
        rawPrs,
        rawTickets: tickets,
        rawSprints: [],
        rawCalendars: [],
        staleThreshold,
        weekStart,
        weekEnd,
        memberNames,
      }));
    } catch {
      return NextResponse.json(emptyDashboard());
    }
  }
}

function emptyDashboard() {
  return {
    prRisk: { count: 0, stale: [] },
    sprintRisk: { onTrack: true, blockedCount: 0, velocity: 0 },
    meetingLoad: [],
    blockers: [],
  };
}

interface BuildInput {
  rawPrs: any[];
  rawTickets: any[];
  rawSprints: any[];
  rawCalendars: any[];
  staleThreshold: string;
  weekStart: Date;
  weekEnd: Date;
  memberNames: Record<string, string>;
}

function buildDashboard(input: BuildInput) {
  const { rawPrs, rawTickets, rawSprints, rawCalendars, staleThreshold, memberNames } = input;

  // ── PR Risk ────────────────────────────────────────────────────────────────
  const stalePrs = rawPrs.filter((pr: any) => {
    const updatedAt = pr.updatedAt ?? pr.updated_at ?? "";
    const approvals = Number(pr.approvals ?? 0);
    const required = Number(pr.requiredApprovals ?? pr.required_approvals ?? 1);
    const isStale = updatedAt ? updatedAt < staleThreshold : true;
    const needsReview = approvals < required;
    return isStale || needsReview;
  });

  const prRiskItems = stalePrs.slice(0, 10).map((pr: any) => ({
    prId: pr.prId ?? pr.pr_id,
    title: pr.title,
    author: pr.author,
    approvals: Number(pr.approvals ?? 0),
    requiredApprovals: Number(pr.requiredApprovals ?? pr.required_approvals ?? 1),
    updatedAt: pr.updatedAt ?? pr.updated_at,
    riskScore: computePrRisk(pr),
  })).sort((a: any, b: any) => b.riskScore - a.riskScore);

  // ── Sprint Risk ────────────────────────────────────────────────────────────
  let sprintRisk = { onTrack: true, blockedCount: 0, velocity: 0 };
  if (rawSprints.length > 0) {
    const sprint = rawSprints[0];
    const stories = sprint.stories ?? [];
    const done = stories.filter((s: any) => s.status === "done").length;
    const blocked = stories.filter((s: any) => s.status === "blocked").length;
    const total = stories.length || 1;
    const completionRatio = done / total;
    sprintRisk = {
      onTrack: completionRatio >= 0.5 && blocked < 2,
      blockedCount: blocked,
      velocity: sprint.velocity ?? 0,
    };
  }

  // ── Blockers ───────────────────────────────────────────────────────────────
  const blockedTickets = rawTickets
    .filter((t: any) => {
      const blockedBy = t.blockedBy ?? (t.blockedByJson ? (() => { try { return JSON.parse(t.blockedByJson); } catch { return []; } })() : []);
      return Array.isArray(blockedBy) && blockedBy.length > 0;
    })
    .slice(0, 10)
    .map((t: any) => ({
      ticketId: t.ticketId ?? t.ticket_id,
      title: t.title,
      priority: t.priority ?? 3,
      status: t.status,
      assignee: t.assignee,
      blockedBy: t.blockedBy ?? [],
    }))
    .sort((a: any, b: any) => (a.priority ?? 3) - (b.priority ?? 3));

  // ── Meeting Load ───────────────────────────────────────────────────────────
  const meetingsByUser: Record<string, number> = {};
  for (const event of rawCalendars) {
    const attendees: string[] = event.attendees ?? event.attendeeEmails ?? [];
    for (const uid of attendees) {
      if (uid) meetingsByUser[uid] = (meetingsByUser[uid] ?? 0) + 1;
    }
    if (event.userId && typeof event.userId === "string") {
      meetingsByUser[event.userId] = (meetingsByUser[event.userId] ?? 0) + 1;
    }
  }

  const meetingLoad = Object.entries(meetingsByUser)
    .map(([uid, count]) => ({
      userId: uid,
      name: memberNames[uid] ?? uid,
      meetingsThisWeek: count,
    }))
    .sort((a, b) => b.meetingsThisWeek - a.meetingsThisWeek)
    .slice(0, 10);

  return {
    prRisk: { count: prRiskItems.length, stale: prRiskItems },
    sprintRisk,
    meetingLoad,
    blockers: blockedTickets,
  };
}

function computePrRisk(pr: any): number {
  let score = 0;
  const approvals = Number(pr.approvals ?? 0);
  const required = Number(pr.requiredApprovals ?? pr.required_approvals ?? 1);
  const updatedAt = pr.updatedAt ?? pr.updated_at ?? "";

  if (approvals === 0) score += 40;
  else if (approvals < required) score += 20;

  if (updatedAt) {
    const ageHours = (Date.now() - new Date(updatedAt).getTime()) / (1000 * 60 * 60);
    if (ageHours > 96) score += 30;
    else if (ageHours > 48) score += 15;
  } else {
    score += 20;
  }

  return score;
}
