import { NextRequest, NextResponse } from "next/server";
import { getDb, COLLECTIONS } from "@/lib/mongodb";
import { embed } from "@/lib/voyage";
import { upsertVectorDoc } from "@/lib/vector-store";
import { getSqliteDbSafe } from "@/lib/sqlite";

// ── POST /api/webhooks/github ─────────────────────────────────────
// Receives GitHub PR events and upserts into prs collection
export async function POST(req: NextRequest) {
  const payload = await req.json();
  const { action, pull_request: pr } = payload;

  // Only process PR events
  if (!pr) return NextResponse.json({ ok: true });

  const teamId = req.headers.get("x-github-team-id") ?? "team-1";

  const doc = {
    prId: `pr-gh-${pr.number}`,
    title: pr.title ?? "",
    body: pr.body ?? "",
    author: pr.user?.login ?? "",
    assignee: pr.assignee?.login ?? pr.requested_reviewers?.[0]?.login ?? "",
    reviewers: (pr.requested_reviewers ?? []).map((r: { login: string }) => r.login),
    approvals: pr.reviews?.filter((r: { state: string }) => r.state === "APPROVED").length ?? 0,
    requiredApprovals: 1,
    files: pr._files ?? [], // populated by a separate GitHub API call if available
    state: pr.state ?? "open",
    checks: pr.head?.sha ? "pending" : "unknown",
    mergeable: pr.mergeable ?? true,
    ticketId: extractTicketId(pr.title, pr.body),
    teamId,
    updatedAt: new Date(pr.updated_at ?? Date.now()),
    createdAt: new Date(pr.created_at ?? Date.now()),
  };

  // Fire-and-forget upsert — respond 200 immediately
  void (async () => {
    try {
      let persistedToSqlite = false;
      try {
        const db = await getDb();
        await db.collection(COLLECTIONS.prs).updateOne({ prId: doc.prId }, { $set: doc }, { upsert: true });
      } catch {
        const sqlite = await getSqliteDbSafe();
        if (sqlite) {
          sqlite
            .prepare(
              `INSERT INTO prs
               (pr_id, team_id, title, body, state, author, assignee, reviewers_json, approvals, required_approvals, checks, mergeable, ticket_id, created_at, updated_at, embedding_json)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(pr_id) DO UPDATE SET
                 team_id = excluded.team_id,
                 title = excluded.title,
                 body = excluded.body,
                 state = excluded.state,
                 author = excluded.author,
                 assignee = excluded.assignee,
                 reviewers_json = excluded.reviewers_json,
                 approvals = excluded.approvals,
                 required_approvals = excluded.required_approvals,
                 checks = excluded.checks,
                 mergeable = excluded.mergeable,
                 ticket_id = excluded.ticket_id,
                 created_at = excluded.created_at,
                 updated_at = excluded.updated_at`
            )
            .run(
              doc.prId,
              doc.teamId,
              doc.title,
              doc.body,
              doc.state,
              doc.author,
              doc.assignee,
              JSON.stringify(doc.reviewers ?? []),
              doc.approvals,
              doc.requiredApprovals,
              doc.checks,
              doc.mergeable ? 1 : 0,
              doc.ticketId ?? null,
              doc.createdAt.toISOString(),
              doc.updatedAt.toISOString(),
              null
            );
          persistedToSqlite = true;
        }
      }

      if (process.env.VOYAGE_API_KEY && `${doc.title} ${doc.body}`.trim()) {
        const embedding = await embed(`${doc.title} ${doc.body}`.trim());
        await upsertVectorDoc({
          source: COLLECTIONS.prs,
          id: doc.prId,
          teamId: doc.teamId,
          text: `${doc.title} ${doc.body}`.trim(),
          embedding,
        });
        if (persistedToSqlite) {
          const sqlite = await getSqliteDbSafe();
          sqlite
            ?.prepare("UPDATE prs SET embedding_json = ? WHERE pr_id = ?")
            .run(JSON.stringify(embedding), doc.prId);
        }
      }
    } catch (err) {
      console.error("GitHub webhook upsert failed:", err);
    }
  })();

  return NextResponse.json({ ok: true });
}

// Extract Jira/Linear ticket ID from PR title or body
// Matches patterns like: JIRA-123, NEO-42, #42
function extractTicketId(title: string, body: string): string | null {
  const text = `${title} ${body}`;
  const match =
    text.match(/\b([A-Z]+-\d+)\b/) ??
    text.match(/#(\d+)/);
  return match ? match[1] : null;
}
