import { NextResponse } from "next/server";
import { getDb, COLLECTIONS } from "@/lib/mongodb";
import { lavaChat } from "@/lib/lava";
import { streamSpeech } from "@/lib/elevenlabs";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SprintForecast {
  onTrack: boolean;
  pointsAtRisk: number;
  bottleneck: string;
  recommendation: string;
}

interface ReleaseNotes {
  internal: string;
  external: string;
}

interface RetroDraft {
  wentWell: string;
  didntGoWell: string;
  patterns: string;
  teamId: string;
  sprintId: string;
  createdAt: Date;
}

// ─── POST handler — routes to sub-actions based on pathname ──────────────────

export async function POST(req: Request): Promise<Response> {
  const pathname = new URL(req.url).pathname;

  if (pathname.endsWith("/forecast")) {
    return handleForecast(req);
  }
  if (pathname.endsWith("/release-notes")) {
    return handleReleaseNotes(req);
  }
  if (pathname.endsWith("/retro")) {
    return handleRetro(req);
  }

  return NextResponse.json(
    { error: "Unknown sprint endpoint" },
    { status: 404 },
  );
}

// ─── GET handler — sprint dashboard data ─────────────────────────────────────

export async function GET(req: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(req.url);
    const teamId = searchParams.get("teamId");

    if (!teamId) {
      return NextResponse.json(
        { error: "teamId is required" },
        { status: 400 },
      );
    }

    const db = await getDb();

    // Get the most recent sprint for this team
    const sprint = await db
      .collection(COLLECTIONS.sprints)
      .findOne({ teamId }, { sort: { createdAt: -1 } } as any);

    if (!sprint) {
      return NextResponse.json({
        sprint: null,
        message: "No sprint found for team",
      });
    }

    const stories: any[] = sprint.stories ?? [];
    const totalPoints: number = stories.reduce(
      (sum: number, s: any) => sum + (s.points ?? 0),
      0,
    );
    const completedPoints: number = stories
      .filter((s: any) => s.status === "done")
      .reduce((sum: number, s: any) => sum + (s.points ?? 0), 0);
    const blockedPoints: number = stories
      .filter((s: any) => s.blocked)
      .reduce((sum: number, s: any) => sum + (s.points ?? 0), 0);

    // Count blocked PRs
    const blockedPrCount: number = await db
      .collection(COLLECTIONS.prs)
      .countDocuments({ teamId, state: "open", checks: "failing" });

    return NextResponse.json({
      sprint: {
        sprintId: sprint.sprintId,
        name: sprint.name,
        teamId: sprint.teamId,
        startDate: sprint.startDate,
        endDate: sprint.endDate,
        velocity: sprint.velocity ?? 0,
        storyPoints: {
          total: totalPoints,
          completed: completedPoints,
          blocked: blockedPoints,
          remaining: totalPoints - completedPoints,
        },
        blockedPrCount,
        forecast: sprint.forecast ?? null,
        createdAt: sprint.createdAt,
      },
    });
  } catch (error: any) {
    console.error("[sprint GET] Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// ─── Forecast ─────────────────────────────────────────────────────────────────

async function handleForecast(req: Request): Promise<Response> {
  try {
    const body = await req.json();
    const { teamId } = body;

    if (!teamId) {
      return NextResponse.json(
        { error: "teamId is required" },
        { status: 400 },
      );
    }

    const db = await getDb();
    const now = new Date();

    // Read sprint data
    const sprint = await db
      .collection(COLLECTIONS.sprints)
      .findOne({ teamId }, { sort: { createdAt: -1 } } as any);

    if (!sprint) {
      return NextResponse.json(
        { error: "No active sprint found for team" },
        { status: 404 },
      );
    }

    const stories: any[] = sprint.stories ?? [];
    const totalPoints = stories.reduce(
      (sum: number, s: any) => sum + (s.points ?? 0),
      0,
    );
    const completedPoints = stories
      .filter((s: any) => s.status === "done")
      .reduce((sum: number, s: any) => sum + (s.points ?? 0), 0);
    const blockedStories = stories.filter((s: any) => s.blocked);

    // Count open + blocked PRs for the team
    const [openPrs, openTickets] = await Promise.all([
      db.collection(COLLECTIONS.prs).find({ teamId, state: "open" }).toArray(),
      db
        .collection(COLLECTIONS.tickets)
        .find({ teamId, status: { $ne: "Done" } })
        .toArray(),
    ]);

    const blockedPrCount = openPrs.filter(
      (pr: any) => (pr.approvals ?? 0) < (pr.requiredApprovals ?? 1),
    ).length;

    // Calculate sprint duration and time elapsed
    const sprintStart = new Date(sprint.startDate);
    const sprintEnd = new Date(sprint.endDate);
    const totalDays = Math.max(
      1,
      (sprintEnd.getTime() - sprintStart.getTime()) / (1000 * 60 * 60 * 24),
    );
    const elapsedDays = Math.max(
      0,
      (now.getTime() - sprintStart.getTime()) / (1000 * 60 * 60 * 24),
    );
    const remainingDays = Math.max(0, totalDays - elapsedDays);
    const progressPct = (elapsedDays / totalDays) * 100;

    const contextSummary = `
Sprint: ${sprint.name}
Total story points: ${totalPoints}
Completed story points: ${completedPoints}
Blocked story points: ${blockedStories.reduce((s: number, st: any) => s + (st.points ?? 0), 0)}
Historical velocity (points/sprint): ${sprint.velocity ?? "unknown"}
Days elapsed: ${elapsedDays.toFixed(1)} of ${totalDays.toFixed(1)} total days (${progressPct.toFixed(0)}% of sprint done)
Days remaining: ${remainingDays.toFixed(1)}
Open PRs: ${openPrs.length} (${blockedPrCount} blocked / unreviewed)
Open tickets: ${openTickets.length}
Blocked stories: ${JSON.stringify(blockedStories.map((s: any) => s.title ?? s.id))}
    `.trim();

    const prompt = `You are Neo, a sprint health analyst for engineering teams.

Based on the sprint data below, produce a JSON forecast with these exact fields:
{
  "onTrack": boolean,        // true if the team is on pace to complete the sprint
  "pointsAtRisk": number,    // story points unlikely to be completed this sprint
  "bottleneck": string,      // one clear sentence identifying the main bottleneck
  "recommendation": string   // one actionable recommendation for the EM
}

Respond ONLY with valid JSON. No explanation, no markdown.

Sprint data:
${contextSummary}`;

    const raw = await lavaChat("neo-sprint", [
      { role: "user", content: prompt },
    ]);

    // Parse Claude's JSON response
    let forecast: SprintForecast;
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      forecast = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
    } catch {
      // Fallback if JSON parse fails
      const pointsAtRisk = Math.max(
        0,
        totalPoints -
          completedPoints -
          Math.round(sprint.velocity ?? completedPoints),
      );
      forecast = {
        onTrack: completedPoints / totalPoints >= elapsedDays / totalDays,
        pointsAtRisk,
        bottleneck: raw.slice(0, 200),
        recommendation: "Review blocked PRs and redistribute work.",
      };
    }

    // Persist forecast back to sprint document
    await db
      .collection(COLLECTIONS.sprints)
      .updateOne(
        { _id: sprint._id },
        { $set: { forecast, forecastedAt: now } },
      );

    // Log agent run
    await db.collection(COLLECTIONS.agents).insertOne({
      agent: "neo-sprint",
      action: "forecast",
      input: { teamId },
      output: forecast,
      teamId,
      durationMs: Date.now() - now.getTime(),
      createdAt: now,
    });

    // Stream audio if requested
    const accept = req.headers.get("accept") ?? "";
    if (accept.includes("audio/mpeg")) {
      const spokenForecast = `Sprint is ${forecast.onTrack ? "on track" : "at risk"}. ${
        forecast.pointsAtRisk > 0
          ? `${forecast.pointsAtRisk} story points are at risk. `
          : ""
      }${forecast.bottleneck} ${forecast.recommendation}`;

      const audioStream = await streamSpeech(spokenForecast);
      return new Response(audioStream, {
        headers: {
          "Content-Type": "audio/mpeg",
          "Transfer-Encoding": "chunked",
        },
      });
    }

    return NextResponse.json(forecast);
  } catch (error: any) {
    console.error("[sprint/forecast] Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// ─── Release Notes ────────────────────────────────────────────────────────────

async function handleReleaseNotes(req: Request): Promise<Response> {
  try {
    const body = await req.json();
    const { teamId, sprintId } = body;

    if (!teamId || !sprintId) {
      return NextResponse.json(
        { error: "teamId and sprintId are required" },
        { status: 400 },
      );
    }

    const db = await getDb();
    const now = new Date();

    // Get all merged PRs for this sprint
    const mergedPrs = await db
      .collection(COLLECTIONS.prs)
      .find({ teamId, state: "merged", sprintId })
      .toArray();

    if (mergedPrs.length === 0) {
      return NextResponse.json(
        { error: "No merged PRs found for this sprint" },
        { status: 404 },
      );
    }

    const prList = mergedPrs
      .map(
        (pr: any, i: number) =>
          `${i + 1}. [${pr.prId}] ${pr.title}\n   Author: ${pr.author}\n   Description: ${pr.body ?? "N/A"}`,
      )
      .join("\n\n");

    const prompt = `You are a technical writer. Given the list of merged pull requests below, write two versions of release notes.

Return ONLY valid JSON with this exact structure:
{
  "internal": "...",
  "external": "..."
}

Guidelines:
- "internal": technical version for the engineering team — include PR numbers, technical details, mentions of specific systems changed
- "external": customer-facing version — plain English, no PR numbers, no jargon, focus on features and bug fixes users care about
- Group related changes. Use complete sentences.

Merged PRs for this sprint:
${prList}`;

    const raw = await lavaChat("neo-sprint-notes", [
      { role: "user", content: prompt },
    ]);

    let notes: ReleaseNotes;
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      notes = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
    } catch {
      notes = {
        internal: raw,
        external: raw,
      };
    }

    // Log agent run
    await db.collection(COLLECTIONS.agents).insertOne({
      agent: "neo-sprint",
      action: "release-notes",
      input: { teamId, sprintId, prCount: mergedPrs.length },
      output: {
        internalLength: notes.internal.length,
        externalLength: notes.external.length,
      },
      teamId,
      createdAt: now,
    });

    return NextResponse.json(notes);
  } catch (error: any) {
    console.error("[sprint/release-notes] Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// ─── Retro ────────────────────────────────────────────────────────────────────

async function handleRetro(req: Request): Promise<Response> {
  try {
    const body = await req.json();
    const { teamId, sprintId } = body;

    if (!teamId || !sprintId) {
      return NextResponse.json(
        { error: "teamId and sprintId are required" },
        { status: 400 },
      );
    }

    const db = await getDb();
    const now = new Date();

    // Current sprint
    const sprint = await db
      .collection(COLLECTIONS.sprints)
      .findOne({ teamId, sprintId });

    if (!sprint) {
      return NextResponse.json({ error: "Sprint not found" }, { status: 404 });
    }

    // Last 3 sprints for pattern comparison
    const pastSprints = await db
      .collection(COLLECTIONS.sprints)
      .find({ teamId, sprintId: { $ne: sprintId } })
      .sort({ createdAt: -1 } as any)
      .limit(3)
      .toArray();

    const stories: any[] = sprint.stories ?? [];
    const totalPoints = stories.reduce(
      (s: number, st: any) => s + (st.points ?? 0),
      0,
    );
    const completedPoints = stories
      .filter((s: any) => s.status === "done")
      .reduce((sum: number, s: any) => sum + (s.points ?? 0), 0);

    // Agent logs for this sprint (nudges, scans, etc.)
    const agentLogs = await db
      .collection(COLLECTIONS.agents)
      .find({ teamId, createdAt: { $gte: new Date(sprint.startDate) } })
      .toArray();

    const pastSummary = pastSprints
      .map(
        (ps: any) =>
          `Sprint "${ps.name}": velocity=${ps.velocity}, forecast=${JSON.stringify(ps.forecast ?? "N/A")}`,
      )
      .join("\n");

    const contextSummary = `
Current sprint: ${sprint.name}
Story points: ${completedPoints} completed of ${totalPoints} total
Velocity: ${sprint.velocity ?? "N/A"}
Blocked stories: ${stories.filter((s: any) => s.blocked).length}
Agent actions taken: ${agentLogs.length} (nudges, scans, forecasts)

Past 3 sprints for comparison:
${pastSummary || "No past sprint data available"}
    `.trim();

    const prompt = `You are Neo, an AI scrum master helping a team run a sprint retrospective.

Based on the sprint data, write a retro draft. Return ONLY valid JSON with this structure:
{
  "wentWell": "...",
  "didntGoWell": "...",
  "patterns": "..."
}

Guidelines:
- "wentWell": concrete things that went well this sprint (velocity, PR merge speed, collaboration, etc.)
- "didntGoWell": concrete things that hurt the sprint (blockers, missed stories, bottlenecks)
- "patterns": observations comparing this sprint to the past 3 — note trends (improving, worsening, recurring issues)
- Write in plain prose, not bullet points. Be specific where data supports it.

Sprint data:
${contextSummary}`;

    const raw = await lavaChat("neo-sprint-notes", [
      { role: "user", content: prompt },
    ]);

    let retro: Omit<RetroDraft, "teamId" | "sprintId" | "createdAt">;
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      retro = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
    } catch {
      retro = {
        wentWell:
          "Unable to parse structured retro. Raw output: " + raw.slice(0, 500),
        didntGoWell: "",
        patterns: "",
      };
    }

    const retroDoc: RetroDraft = { ...retro, teamId, sprintId, createdAt: now };

    // Log agent run
    await db.collection(COLLECTIONS.agents).insertOne({
      agent: "neo-sprint",
      action: "retro",
      input: { teamId, sprintId },
      output: retroDoc,
      teamId,
      createdAt: now,
    });

    return NextResponse.json(retroDoc);
  } catch (error: any) {
    console.error("[sprint/retro] Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
