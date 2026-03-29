import { NextRequest, NextResponse } from "next/server";
import { getDb, COLLECTIONS } from "@/lib/mongodb";
import { getSessionUser } from "@/lib/current-user";

export interface SessionMeta {
  sessionId: string;
  title: string;
  preview: string;
  updatedAt: string;
  messageCount: number;
}

export interface SessionTurn {
  role: "user" | "assistant";
  content: string;
  agentUsed?: string;
  timestamp: string;
}

/**
 * GET /api/agents/chat/sessions
 *   ?userId=xxx           → list all sessions for user (most recent first)
 *   ?sessionId=xxx        → load full turns for one session
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const sessionIdParam = url.searchParams.get("sessionId");

  const user = await getSessionUser().catch(() => null);
  const userId = url.searchParams.get("userId") ?? user?.userId ?? "user-1";

  try {
    const db = await getDb();

    // ── Load single session ──────────────────────────────────────────────
    if (sessionIdParam) {
      const doc = await db
        .collection(COLLECTIONS.conversations)
        .findOne({ sessionId: sessionIdParam });

      if (!doc) return NextResponse.json({ turns: [] });

      const turns: SessionTurn[] = ((doc.turns ?? []) as any[]).map((t) => ({
        role: t.role as "user" | "assistant",
        content: t.content ?? "",
        agentUsed: t.agentUsed,
        timestamp:
          t.timestamp instanceof Date
            ? t.timestamp.toISOString()
            : String(t.timestamp ?? ""),
      }));

      return NextResponse.json({ turns });
    }

    // ── List all sessions for user ────────────────────────────────────────
    const docs = await db
      .collection(COLLECTIONS.conversations)
      .find({ userId })
      .sort({ updatedAt: -1 })
      .limit(50)
      .toArray();

    const sessions: SessionMeta[] = docs
      .map((doc: any) => {
        const turns: any[] = doc.turns ?? [];
        const firstUser = turns.find((t) => t.role === "user");
        const lastTurn = turns[turns.length - 1];
        const title = firstUser?.content
          ? firstUser.content.slice(0, 60) + (firstUser.content.length > 60 ? "…" : "")
          : "New conversation";
        const preview = lastTurn?.content
          ? lastTurn.content.slice(0, 80) + (lastTurn.content.length > 80 ? "…" : "")
          : "";

        return {
          sessionId: String(doc.sessionId ?? ""),
          title,
          preview,
          updatedAt:
            doc.updatedAt instanceof Date
              ? doc.updatedAt.toISOString()
              : String(doc.updatedAt ?? new Date().toISOString()),
          messageCount: turns.length,
        };
      })
      .filter((s) => s.sessionId && s.messageCount > 0);

    return NextResponse.json({ sessions });
  } catch (err: any) {
    return NextResponse.json(
      { sessions: [], error: err?.message ?? "Failed to load sessions" },
      { status: 200 }
    );
  }
}

/**
 * DELETE /api/agents/chat/sessions?sessionId=xxx
 * Removes a single conversation session.
 */
export async function DELETE(req: NextRequest) {
  const url = new URL(req.url);
  const sessionId = url.searchParams.get("sessionId");
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }

  try {
    const db = await getDb();
    await db.collection(COLLECTIONS.conversations).deleteMany({ sessionId });
    return NextResponse.json({ deleted: true });
  } catch {
    return NextResponse.json({ deleted: false });
  }
}
