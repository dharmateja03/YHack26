import { COLLECTIONS, getDb } from "@/lib/mongodb";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const teamId = searchParams.get("teamId");
  if (!teamId) return Response.json({ error: "teamId required" }, { status: 400 });

  const db = await getDb();
  const rows = await db.collection(COLLECTIONS.tickets).find({ teamId }).toArray();

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
