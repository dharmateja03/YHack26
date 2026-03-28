import { NextResponse } from "next/server";
import { getDb, COLLECTIONS } from "@/lib/mongodb";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const teamId = searchParams.get("teamId");

    if (!teamId) {
      return NextResponse.json(
        { error: "teamId query parameter is required" },
        { status: 400 },
      );
    }

    const db = await getDb();

    // Fetch the most recent sprint for this team
    const sprint = await db
      .collection(COLLECTIONS.sprints)
      .find({ teamId })
      .sort({ createdAt: -1 })
      .limit(1)
      .next();

    if (!sprint) {
      return NextResponse.json({ sprint: null });
    }

    // Derive story point totals from the stories array
    const stories: Array<{
      points?: number;
      status?: string;
      blocked?: boolean;
    }> = sprint.stories ?? [];

    const totalPoints = stories.reduce((sum, s) => sum + (s.points ?? 0), 0);
    const completedPoints = stories
      .filter((s) => s.status === "done" || s.status === "complete")
      .reduce((sum, s) => sum + (s.points ?? 0), 0);
    const blockedPoints = stories
      .filter((s) => s.blocked === true)
      .reduce((sum, s) => sum + (s.points ?? 0), 0);
    const remainingPoints = totalPoints - completedPoints;

    return NextResponse.json({
      sprint: {
        sprintId: sprint.sprintId,
        teamId: sprint.teamId,
        name: sprint.name,
        startDate: sprint.startDate,
        endDate: sprint.endDate,
        velocity: sprint.velocity ?? null,
        storyPoints: {
          total: totalPoints,
          completed: completedPoints,
          remaining: remainingPoints,
          blocked: blockedPoints,
        },
        forecast: sprint.forecast ?? null,
        createdAt: sprint.createdAt,
      },
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    console.error("[data/sprint GET]", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
