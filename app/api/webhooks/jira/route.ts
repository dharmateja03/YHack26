import { COLLECTIONS, getDb } from "@/lib/mongodb";

const PRIORITY_TO_NUM: Record<string, number> = {
  Highest: 1,
  High: 2,
  Medium: 3,
  Low: 4,
  Lowest: 5,
};

function mapPriority(priorityName?: string): number {
  if (!priorityName) return 3;
  return PRIORITY_TO_NUM[priorityName] ?? 3;
}

export async function POST(req: Request) {
  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const issue = payload?.issue;
  if (!issue) return Response.json({ ok: true });

  const fields = issue.fields ?? {};
  const doc = {
    ticketId: String(issue.id ?? ""),
    title: String(fields.summary ?? ""),
    description: String(fields.description ?? ""),
    status: String(fields.status?.name ?? "Open"),
    priority: mapPriority(fields.priority?.name),
    assignee: String(fields.assignee?.displayName ?? ""),
    reporter: String(fields.reporter?.displayName ?? ""),
    teamId: "team-1",
    updatedAt: new Date(),
  };

  const db = await getDb();
  await db
    .collection(COLLECTIONS.tickets)
    .updateOne({ ticketId: doc.ticketId }, { $set: doc, $setOnInsert: { createdAt: new Date() } }, { upsert: true });

  return Response.json({ ok: true });
}

