import { COLLECTIONS, getDb } from "@/lib/mongodb";
import { getSqliteDbSafe } from "@/lib/sqlite";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const teamId = searchParams.get("teamId");
  if (!teamId) return Response.json({ error: "teamId required" }, { status: 400 });

  let rows: any[] = [];
  try {
    const db = await getDb();
    rows = await db
      .collection(COLLECTIONS.prs)
      .find({ teamId, state: "open" })
      .toArray();
  } catch {
    const sqlite = await getSqliteDbSafe();
    if (sqlite) {
      rows = sqlite
        .prepare(
          `SELECT pr_id AS prId, title, author, updated_at AS updatedAt, approvals, state
           FROM prs
           WHERE team_id = ? AND state = 'open'
           ORDER BY updated_at DESC
           LIMIT 200`
        )
        .all(teamId);
    }
  }

  const now = Date.now();
  const prs = rows.map((pr: any) => ({
    prId: pr.prId,
    title: pr.title,
    author: pr.author,
    waitHours: Math.floor((now - new Date(pr.updatedAt ?? Date.now()).getTime()) / 3_600_000),
    approvals: pr.approvals ?? 0,
    state: pr.state ?? "open",
  }));

  return Response.json({ prs });
}
