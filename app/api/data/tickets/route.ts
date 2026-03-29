import { COLLECTIONS, getDb } from "@/lib/mongodb";
import { getSqliteDbSafe } from "@/lib/sqlite";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const teamId = searchParams.get("teamId");
  if (!teamId) return Response.json({ error: "teamId required" }, { status: 400 });

  let rows: any[] = [];
  try {
    const db = await getDb();
    rows = await db.collection(COLLECTIONS.tickets).find({ teamId }).toArray();
  } catch {
    const sqlite = await getSqliteDbSafe();
    if (sqlite) {
      rows = sqlite
        .prepare(
          `SELECT ticket_id AS ticketId, title, priority, status, assignee, blocked_by_json AS blockedBy
           FROM tickets
           WHERE team_id = ?
           ORDER BY updated_at DESC
           LIMIT 300`
        )
        .all(teamId)
        .map((row: any) => ({
          ...row,
          blockedBy: (() => {
            try {
              return JSON.parse(String(row.blockedBy ?? "[]"));
            } catch {
              return [];
            }
          })(),
        }));
    }
  }

  const tickets = rows.map((t: any) => ({
    ticketId: t.ticketId ?? "",
    title: t.title ?? "",
    priority: typeof t.priority === "number" ? t.priority : 3,
    status: t.status ?? "Open",
    assignee: t.assignee ?? "",
    blockedBy: Array.isArray(t.blockedBy) ? t.blockedBy : [],
  }));

  return Response.json({ tickets });
}
