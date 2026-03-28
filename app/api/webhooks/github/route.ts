import { NextRequest, NextResponse } from "next/server";
import { getDb, COLLECTIONS } from "@/lib/mongodb";

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
  const db = await getDb();
  db.collection(COLLECTIONS.prs)
    .updateOne({ prId: doc.prId }, { $set: doc }, { upsert: true })
    .catch((err) => console.error("GitHub webhook upsert failed:", err));

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
