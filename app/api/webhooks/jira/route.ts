import { COLLECTIONS, getDb } from "@/lib/mongodb";
import { embed } from "@/lib/voyage";
import { upsertVectorDoc } from "@/lib/vector-store";
import { getSqliteDbSafe } from "@/lib/sqlite";

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
  const title = String(fields.summary ?? "");
  const description = String(fields.description ?? "");

  // Embed title + description for Atlas Vector Search
  const embedding = await embed(`${title} ${description}`);

  const doc = {
    ticketId: String(issue.id ?? ""),
    title,
    description,
    status: String(fields.status?.name ?? "Open"),
    priority: mapPriority(fields.priority?.name),
    assignee: String(fields.assignee?.displayName ?? ""),
    reporter: String(fields.reporter?.displayName ?? ""),
    sprintId: String(fields.sprint?.id ?? ""),
    teamId: "team-1",
    blockedBy: Array.isArray(fields.blockedBy) ? fields.blockedBy : [],
    embedding,
    updatedAt: new Date(),
  };

  let persistedToSqlite = false;
  try {
    const db = await getDb();
    await db
      .collection(COLLECTIONS.tickets)
      .updateOne(
        { ticketId: doc.ticketId },
        { $set: doc, $setOnInsert: { createdAt: new Date() } },
        { upsert: true }
      );
  } catch {
    const sqlite = await getSqliteDbSafe();
    if (sqlite) {
      sqlite
        .prepare(
          `INSERT INTO tickets
           (ticket_id, team_id, title, description, status, priority, assignee, reporter, sprint_id, blocked_by_json, created_at, updated_at, embedding_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(ticket_id) DO UPDATE SET
             team_id = excluded.team_id,
             title = excluded.title,
             description = excluded.description,
             status = excluded.status,
             priority = excluded.priority,
             assignee = excluded.assignee,
             reporter = excluded.reporter,
             sprint_id = excluded.sprint_id,
             blocked_by_json = excluded.blocked_by_json,
             updated_at = excluded.updated_at,
             embedding_json = excluded.embedding_json`
        )
        .run(
          doc.ticketId,
          doc.teamId,
          doc.title,
          doc.description,
          doc.status,
          doc.priority,
          doc.assignee || null,
          doc.reporter || null,
          doc.sprintId || null,
          JSON.stringify(doc.blockedBy ?? []),
          new Date().toISOString(),
          doc.updatedAt.toISOString(),
          JSON.stringify(embedding)
        );
      persistedToSqlite = true;
    }
  }

  await upsertVectorDoc({
    source: COLLECTIONS.tickets,
    id: doc.ticketId,
    teamId: doc.teamId,
    text: `${doc.title} ${doc.description}`.trim(),
    embedding,
  });

  if (persistedToSqlite) {
    const sqlite = await getSqliteDbSafe();
    sqlite
      ?.prepare("UPDATE tickets SET embedding_json = ? WHERE ticket_id = ?")
      .run(JSON.stringify(embedding), doc.ticketId);
  }

  return Response.json({ ok: true });
}
