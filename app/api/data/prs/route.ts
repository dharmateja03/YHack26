import { COLLECTIONS, getDb } from "@/lib/mongodb";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const teamId = searchParams.get("teamId");
  if (!teamId) return Response.json({ error: "teamId required" }, { status: 400 });

  const db = await getDb();
  const rows = await db
    .collection(COLLECTIONS.prs)
    .find({ teamId, state: "open" })
    .toArray();

  const now = Date.now();
  const prs = rows.map((pr) => ({
    prId: pr.prId,
    title: pr.title,
    author: pr.author,
    waitHours: Math.floor((now - new Date(pr.updatedAt ?? Date.now()).getTime()) / 3_600_000),
  }));

  return Response.json({ prs });
}

