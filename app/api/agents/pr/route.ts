import { NextRequest, NextResponse } from "next/server";
import { getDb, COLLECTIONS } from "@/lib/mongodb";
import { getSqliteDbSafe } from "@/lib/sqlite";
import { lavaChat } from "@/lib/lava";
import { resolveTeamAwareness } from "@/lib/agent-context";

async function getDbSafe() {
  try { return await getDb(); } catch { return null; }
}

function sqlitePrs(teamId: string): any[] {
  // Synchronous helper — caller awaits getSqliteDbSafe separately
  return [];
}

async function loadOpenPrs(teamId: string): Promise<any[]> {
  const db = await getDbSafe();
  if (db) {
    return db.collection(COLLECTIONS.prs).find({ teamId, state: "open" }).toArray();
  }
  const sqlite = await getSqliteDbSafe();
  if (!sqlite) return [];
  const rows = sqlite
    .prepare(
      `SELECT pr_id, title, body, state, author, assignee, reviewers_json,
              approvals, required_approvals, checks, mergeable, ticket_id,
              created_at, updated_at
       FROM prs WHERE team_id = ? AND state = 'open' ORDER BY updated_at DESC`
    )
    .all(teamId) as any[];
  return rows.map((r: any) => ({
    prId: r.pr_id, title: r.title, body: r.body, state: r.state,
    author: r.author, assignee: r.assignee,
    reviewers: (() => { try { return JSON.parse(r.reviewers_json ?? "[]"); } catch { return []; } })(),
    approvals: r.approvals ?? 0, requiredApprovals: r.required_approvals ?? 1,
    checks: r.checks ?? "unknown", mergeable: !!r.mergeable,
    ticketId: r.ticket_id, files: [],
    createdAt: r.created_at, updatedAt: r.updated_at,
  }));
}

async function loadPrById(prId: string): Promise<any | null> {
  const db = await getDbSafe();
  if (db) return db.collection(COLLECTIONS.prs).findOne({ prId });
  const sqlite = await getSqliteDbSafe();
  if (!sqlite) return null;
  const r = sqlite.prepare(
    `SELECT pr_id, title, body, state, author, assignee, reviewers_json,
            approvals, required_approvals, checks, mergeable, ticket_id,
            created_at, updated_at, team_id
     FROM prs WHERE pr_id = ?`
  ).get(prId) as any;
  if (!r) return null;
  return {
    prId: r.pr_id, title: r.title, body: r.body, state: r.state,
    author: r.author, assignee: r.assignee, teamId: r.team_id,
    approvals: r.approvals ?? 0, requiredApprovals: r.required_approvals ?? 1,
    checks: r.checks ?? "unknown", mergeable: !!r.mergeable,
    ticketId: r.ticket_id, files: [],
    updatedAt: r.updated_at,
  };
}

// ── GET /api/agents/pr?teamId=xxx ─────────────────────────────────
// Returns all open PRs with wait hours calculated
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const teamCtx = await resolveTeamAwareness({
    teamId: searchParams.get("teamId") ?? undefined,
    fallbackTeamId: "team-1",
  });
  const teamId = teamCtx.teamId;

  const db = await getDb();
  const prs = await db
    .collection(COLLECTIONS.prs)
    .find({ teamId, state: "open" })
    .toArray();

  const now = Date.now();
  const result = prs.map((pr) => ({
    prId: pr.prId,
    title: pr.title,
    author: pr.author,
    assignee: pr.assignee,
    approvals: pr.approvals,
    requiredApprovals: pr.requiredApprovals,
    checks: pr.checks,
    mergeable: pr.mergeable,
    ticketId: pr.ticketId,
    waitHours: Math.floor((now - new Date(pr.updatedAt).getTime()) / 3_600_000),
    files: pr.files,
  }));

  return NextResponse.json({ prs: result });
}

// ── POST /api/agents/pr ───────────────────────────────────────────
// Routes to sub-actions based on URL path segment
export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const path = url.pathname;
  const action = url.searchParams.get("action");

  if (action === "scan") return handleScan(req);
  if (action === "route") return handleRoute(req);
  if (action === "nudge") return handleNudge(req);
  if (action === "merge-check") return handleMergeCheck(req);

  if (path.endsWith("/scan")) return handleScan(req);
  if (path.endsWith("/route")) return handleRoute(req);
  if (path.endsWith("/nudge")) return handleNudge(req);
  if (path.endsWith("/merge-check")) return handleMergeCheck(req);

  return NextResponse.json({ error: "Unknown action" }, { status: 404 });
}

// ── POST /api/agents/pr/scan ──────────────────────────────────────
async function handleScan(req: NextRequest) {
  const body = await req.json();
  const teamCtx = await resolveTeamAwareness({
    userId: body?.userId,
    teamId: body?.teamId,
    fallbackTeamId: "team-1",
  });
  const teamId = teamCtx.teamId;

  const db = await getDb();
  const prs = await db
    .collection(COLLECTIONS.prs)
    .find({ teamId, state: "open" })
    .toArray();

  const now = Date.now();
  const stalePrs = prs.filter(
    (pr) => (now - new Date(pr.updatedAt).getTime()) / 3_600_000 >= 12
  );

  // Conflict detection: PRs sharing the same files
  const conflicts: { pr1: string; pr2: string; sharedFiles: string[] }[] = [];
  for (let i = 0; i < prs.length; i++) {
    for (let j = i + 1; j < prs.length; j++) {
      const shared = prs[i].files?.filter((f: string) => prs[j].files?.includes(f)) ?? [];
      if (shared.length > 0) {
        conflicts.push({ pr1: prs[i].prId, pr2: prs[j].prId, sharedFiles: shared });
      }
    }
  }

  const prSummary = stalePrs.map(
    (pr) =>
      `PR ${pr.prId} "${pr.title}" by ${pr.author} — assigned to ${pr.assignee}, ` +
      `${Math.floor((now - new Date(pr.updatedAt).getTime()) / 3_600_000)}h unreviewed, ` +
      `checks: ${pr.checks}, approvals: ${pr.approvals}/${pr.requiredApprovals}`
  );

  const analysis = await lavaChat("neo-pr", [
    {
      role: "system",
      content:
        "You are a PR triage agent. Given a list of stale PRs, return a JSON array of blockers. " +
        'Each item: { "prId": string, "reason": string, "urgency": "high"|"medium"|"low", "suggestedAction": string }. ' +
        "Return only valid JSON.\n" +
        `Team context:\n${teamCtx.orgSummary}`,
    },
    {
      role: "user",
      content:
        stalePrs.length === 0
          ? "No stale PRs right now."
          : `Stale PRs to analyze:\n${prSummary.join("\n")}`,
    },
  ]);

  let blockers = [];
  try {
    blockers = JSON.parse(analysis);
  } catch {
    blockers = [{ raw: analysis }];
  }

  // Log to agents collection
  await db.collection(COLLECTIONS.agents).insertOne({
    agent: "neo-pr",
    action: "scan",
    input: { teamId },
    output: { blockers, conflicts },
    teamId,
    durationMs: 0,
    createdAt: new Date(),
  });

  return NextResponse.json({ blockers, conflicts, stalePrCount: stalePrs.length });
}

// ── POST /api/agents/pr/route ─────────────────────────────────────
async function handleRoute(req: NextRequest) {
  const body = await req.json();
  const { prId } = body;
  if (!prId) return NextResponse.json({ error: "prId required" }, { status: 400 });

  const db = await getDb();
  const pr = await db.collection(COLLECTIONS.prs).findOne({ prId });
  if (!pr) return NextResponse.json({ error: "PR not found" }, { status: 404 });
  const teamCtx = await resolveTeamAwareness({
    userId: body?.userId,
    teamId: pr.teamId ?? body?.teamId,
    fallbackTeamId: "team-1",
  });

  // Find reviewers who have touched the same files in other merged PRs
  const relatedPrs = await db
    .collection(COLLECTIONS.prs)
    .find({
      prId: { $ne: prId },
      files: { $in: pr.files ?? [] },
    })
    .toArray();

  // Count file-overlap frequency per author
  const authorScore: Record<string, number> = {};
  for (const related of relatedPrs) {
    const overlap = (related.files ?? []).filter((f: string) =>
      pr.files?.includes(f)
    ).length;
    authorScore[related.author] = (authorScore[related.author] ?? 0) + overlap;
  }

  const ranked = Object.entries(authorScore)
    .sort((a, b) => b[1] - a[1])
    .map(([author, score]) => ({ author, score }));

  const suggestion = await lavaChat("neo-pr", [
    {
      role: "system",
      content:
        "You are a reviewer routing agent. Given a PR and a ranked list of candidate reviewers by file history, " +
        "pick the best one and explain why in one sentence. " +
        'Return JSON: { "suggestedReviewer": string, "reason": string }\n' +
        `Team context:\n${teamCtx.orgSummary}`,
    },
    {
      role: "user",
      content: `PR: "${pr.title}" — files: ${pr.files?.join(", ")}\nCandidates: ${JSON.stringify(ranked)}`,
    },
  ]);

  let result = { suggestedReviewer: ranked[0]?.author ?? pr.assignee, reason: "" };
  try {
    result = JSON.parse(suggestion);
  } catch {
    result.reason = suggestion;
  }

  return NextResponse.json({ prId, ...result, candidates: ranked });
}

// ── POST /api/agents/pr/nudge ─────────────────────────────────────
async function handleNudge(req: NextRequest) {
  const body = await req.json();
  const { prId, reviewerId, confirmed } = body;

  if (!prId || !reviewerId) {
    return NextResponse.json({ error: "prId and reviewerId required" }, { status: 400 });
  }
  if (confirmed !== true) {
    return NextResponse.json(
      { error: "Confirmation required. Pass confirmed: true to send nudge." },
      { status: 400 }
    );
  }

  const db = await getDb();
  const pr = await db.collection(COLLECTIONS.prs).findOne({ prId });
  if (!pr) return NextResponse.json({ error: "PR not found" }, { status: 404 });
  const teamCtx = await resolveTeamAwareness({
    userId: body?.userId,
    teamId: pr.teamId ?? body?.teamId,
    fallbackTeamId: "team-1",
  });

  const message = await lavaChat("neo-pr", [
    {
      role: "system",
      content:
        "Write a single friendly Slack nudge message asking someone to review a PR. " +
        "One sentence. Casual tone. No emojis. No markdown.\n" +
        `Team context:\n${teamCtx.orgSummary}`,
    },
    {
      role: "user",
      content: `Ask ${reviewerId} to review PR "${pr.title}" (${prId}). It has been waiting for review.`,
    },
  ]);

  // Send Slack message if token is available
  let slackSent = false;
  if (process.env.SLACK_BOT_TOKEN) {
    try {
      const prefs = await db
        .collection(COLLECTIONS.preferences)
        .findOne({ githubUsername: reviewerId });

      if (prefs?.slackUserId) {
        await fetch("https://slack.com/api/chat.postMessage", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ channel: prefs.slackUserId, text: message }),
        });
        slackSent = true;
      }
    } catch {
      // Slack send failed — log but don't error
    }
  }

  await db.collection(COLLECTIONS.agents).insertOne({
    agent: "neo-pr",
    action: "nudge",
    input: { prId, reviewerId },
    output: { message, slackSent },
    createdAt: new Date(),
  });

  return NextResponse.json({ sent: true, message, slackSent });
}

// ── POST /api/agents/pr/merge-check ──────────────────────────────
async function handleMergeCheck(req: NextRequest) {
  const { prId } = await req.json();
  if (!prId) return NextResponse.json({ error: "prId required" }, { status: 400 });

  const db = await getDb();
  const pr = await db.collection(COLLECTIONS.prs).findOne({ prId });
  if (!pr) return NextResponse.json({ error: "PR not found" }, { status: 404 });

  // Check for file conflicts with other open PRs
  const conflicting = await db
    .collection(COLLECTIONS.prs)
    .find({
      prId: { $ne: prId },
      state: "open",
      files: { $in: pr.files ?? [] },
    })
    .toArray();

  const checklist = {
    testsGreen: pr.checks === "success",
    allApprovals: pr.approvals >= pr.requiredApprovals,
    noConflicts: conflicting.length === 0,
    ticketLinked: !!pr.ticketId,
    mergeable: pr.mergeable === true,
  };

  const ready = Object.values(checklist).every(Boolean);

  const issues: string[] = [];
  if (!checklist.testsGreen) issues.push(`CI checks are ${pr.checks}`);
  if (!checklist.allApprovals)
    issues.push(`Needs ${pr.requiredApprovals - pr.approvals} more approval(s)`);
  if (!checklist.noConflicts)
    issues.push(`Conflicts with: ${conflicting.map((p) => p.prId).join(", ")}`);
  if (!checklist.ticketLinked) issues.push("No ticket linked");
  if (!checklist.mergeable) issues.push("Not mergeable (conflicts in Git)");

  return NextResponse.json({ prId, ready, checklist, issues });
}
