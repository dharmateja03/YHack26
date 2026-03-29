import { NextResponse } from "next/server";
import { getDb, COLLECTIONS } from "@/lib/mongodb";
import { embed } from "@/lib/voyage";
import { upsertVectorDoc } from "@/lib/vector-store";
import { getSqliteDbSafe } from "@/lib/sqlite";

// ─── Slack URL verification challenge ─────────────────────────────────────
// Slack sends this once when you register the Events API endpoint.
// Must respond with the challenge value immediately.

// ─── Message upsert + embedding ───────────────────────────────────────────
// Returns 200 immediately — upsert and embedding happen asynchronously
// so Slack doesn't retry thinking the endpoint is slow.

export async function POST(req: Request): Promise<NextResponse> {
  let body: Record<string, unknown>;

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // ── URL verification handshake ──────────────────────────────────────────
  if (body.type === "url_verification") {
    return NextResponse.json({ challenge: body.challenge });
  }

  // ── Event callback ──────────────────────────────────────────────────────
  if (body.type === "event_callback") {
    const event = body.event as Record<string, unknown> | undefined;

    if (
      event &&
      (event.type === "message" || event.type === "app_mention") &&
      // Ignore bot messages and message-changed / message-deleted subtypes
      !event.subtype &&
      !event.bot_id
    ) {
      // Fire-and-forget: return 200 before doing DB work so Slack doesn't
      // time out and retry.
      ingestMessage(body, event).catch((err) => {
        console.error("[slack webhook] Background ingest error:", err);
      });
    }

    return NextResponse.json({ ok: true });
  }

  // Unknown event type — ack and move on
  return NextResponse.json({ ok: true });
}

// ─── ingestMessage ─────────────────────────────────────────────────────────

async function ingestMessage(
  body: Record<string, unknown>,
  event: Record<string, unknown>,
): Promise<void> {
  const messageId = event.ts as string;
  const channelId = (event.channel as string) ?? "";
  const author = (event.user as string) ?? "";
  const text = (event.text as string) ?? "";
  const threadId = (event.thread_ts as string) ?? messageId;
  const teamId = (body.team_id as string) ?? "";
  const createdAt = new Date(parseFloat(messageId) * 1000);

  const mentions = extractMentions(text);

  // Build the base document
  const messageDoc: Record<string, unknown> = {
    messageId,
    channelId,
    author,
    text,
    mentions,
    threadId,
    teamId,
    createdAt,
  };

  // Generate Voyage AI embedding on the message text (best-effort — don't
  // block the upsert if the embedding API is unavailable or key is missing).
  if (text.trim() && process.env.VOYAGE_API_KEY) {
    try {
      const embedding = await embed(text);
      messageDoc.embedding = embedding;
    } catch (err) {
      console.error(
        "[slack webhook] Embedding failed — storing without vector:",
        err,
      );
    }
  }

  let persistedToSqlite = false;
  try {
    const db = await getDb();
    await db
      .collection(COLLECTIONS.messages)
      .updateOne({ messageId }, { $set: messageDoc }, { upsert: true });
  } catch {
    const sqlite = await getSqliteDbSafe();
    if (sqlite) {
      sqlite
        .prepare(
          `INSERT INTO messages
           (message_id, team_id, channel_id, author, text, mentions_json, thread_id, created_at, embedding_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(message_id) DO UPDATE SET
             team_id = excluded.team_id,
             channel_id = excluded.channel_id,
             author = excluded.author,
             text = excluded.text,
             mentions_json = excluded.mentions_json,
             thread_id = excluded.thread_id,
             created_at = excluded.created_at,
             embedding_json = excluded.embedding_json`
        )
        .run(
          messageId,
          teamId || "team-1",
          channelId,
          author,
          text,
          JSON.stringify(mentions),
          threadId,
          createdAt.toISOString(),
          Array.isArray(messageDoc.embedding) ? JSON.stringify(messageDoc.embedding) : null
        );
      persistedToSqlite = true;
    }
  }

  if (Array.isArray(messageDoc.embedding)) {
    await upsertVectorDoc({
      source: COLLECTIONS.messages,
      id: messageId,
      teamId: teamId || "team-1",
      text,
      embedding: messageDoc.embedding as number[],
    });
    if (persistedToSqlite) {
      const sqlite = await getSqliteDbSafe();
      sqlite
        ?.prepare("UPDATE messages SET embedding_json = ? WHERE message_id = ?")
        .run(JSON.stringify(messageDoc.embedding), messageId);
    }
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Extract all @-mentioned user IDs from a Slack message text.
 * Slack encodes mentions as <@U12345678> in the raw text.
 */
function extractMentions(text: string): string[] {
  const mentionRegex = /<@([A-Z0-9]+)>/g;
  const mentions: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = mentionRegex.exec(text)) !== null) {
    mentions.push(match[1]);
  }

  return mentions;
}
