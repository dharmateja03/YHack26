import { NextRequest, NextResponse } from "next/server";
import { COLLECTIONS, getDb } from "@/lib/mongodb";
import { lavaChat } from "@/lib/lava";
import {
  getNegotiationByThread,
  getActiveNegotiationByEmail,
  updateNegotiation,
  addEmailToThread,
  analyzeReply,
  sendCounterEmail,
  sendMaxRoundsEmail,
  MAX_NEGOTIATION_ROUNDS,
} from "@/lib/negotiate";
import { resolveTeamAwareness } from "@/lib/agent-context";
import { sendEmail as nylasSendEmail } from "@/lib/nylas";

// ── Types ────────────────────────────────────────────────────────────

interface MailIngestBody {
  action?: "ingest" | "summarize" | "send";
  threadId?: string;
  messageId?: string;
  fromEmail?: string;
  toEmails?: string[];
  toEmail?: string;
  recipientToken?: string;
  subject?: string;
  text?: string;
  body?: string;
  orgId?: string;
  orgRoster?: string;
  userId?: string;
  receivedAt?: string;
}

// ── Reschedule intent detection ──────────────────────────────────────

function hasRescheduleIntent(text?: string): boolean {
  if (!text) return false;
  const t = text.toLowerCase();
  const cues = [
    "reschedule", "move", "can't make", "cannot make",
    "new time", "different time", "postpone", "delay",
    "tomorrow", "next week",
  ];
  return cues.some((c) => t.includes(c));
}

// ── Reconcile linked meetings ────────────────────────────────────────

async function reconcileLinkedMeetings(
  req: NextRequest,
  input: {
    threadId?: string;
    text?: string;
    fromEmail?: string;
    toEmails?: string[];
  }
) {
  const db = await getDb();

  const byThread = input.threadId
    ? await db
        .collection(COLLECTIONS.calendars)
        .find({ threadId: input.threadId, autoReschedule: { $ne: false } })
        .toArray()
    : [];

  const emails = [input.fromEmail, ...(input.toEmails ?? [])]
    .filter((e): e is string => Boolean(e && e.trim()))
    .map((e) => e.trim().toLowerCase());

  const byParticipants = emails.length
    ? await db
        .collection(COLLECTIONS.calendars)
        .find({ attendeeEmails: { $in: emails }, autoReschedule: { $ne: false } })
        .toArray()
    : [];

  const seen = new Set<string>();
  const events = [...byThread, ...byParticipants].filter((e: any) => {
    if (!e?.eventId || seen.has(e.eventId)) return false;
    seen.add(e.eventId);
    return true;
  });

  const results: Array<{ eventId: string; ok: boolean; status?: number; error?: string }> = [];
  if (!hasRescheduleIntent(input.text)) return results;

  for (const event of events) {
    try {
      const res = await fetch(
        new URL("/api/agents/schedule?action=reconcile", req.url),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            eventId: event.eventId,
            threadText: input.text,
            applyDirectly: true,
          }),
        }
      );
      results.push({ eventId: event.eventId, ok: res.ok, status: res.status });
    } catch (error: any) {
      results.push({
        eventId: event.eventId,
        ok: false,
        error: error?.message ?? "reconcile_failed",
      });
    }
  }

  return results;
}

// ── Process negotiation reply ────────────────────────────────────────

async function processNegotiationReply(
  req: NextRequest,
  input: {
    threadId?: string;
    fromEmail?: string;
    text?: string;
  }
): Promise<{
  isNegotiation: boolean;
  negotiationId?: string;
  action?: string;
  newState?: string;
  booked?: boolean;
} | null> {
  if (!input.fromEmail || !input.text) return null;

  // Find active negotiation by thread or by participant email
  let neg = input.threadId
    ? await getNegotiationByThread(input.threadId)
    : null;

  if (!neg) {
    neg = await getActiveNegotiationByEmail(input.fromEmail);
  }

  if (!neg) return null;

  // Add email to the thread record
  await addEmailToThread(neg.negotiationId, input.fromEmail, input.text);

  // Increment round counter
  const currentRounds = (neg.roundCount ?? 0) + 1;
  await updateNegotiation(neg.negotiationId, { roundCount: currentRounds });

  // Guard: too many rounds → escalate to humans
  if (currentRounds > MAX_NEGOTIATION_ROUNDS) {
    await updateNegotiation(neg.negotiationId, { state: "failed" });
    void sendMaxRoundsEmail(neg).catch(() => {});
    return {
      isNegotiation: true,
      negotiationId: neg.negotiationId,
      action: "max_rounds_exceeded",
      newState: "failed",
      booked: false,
    };
  }

  // Analyze the reply
  const analysis = analyzeReply(input.text);

  if (analysis.type === "agree") {
    // Participant agreed — update confidence and book
    await updateNegotiation(neg.negotiationId, {
      state: "agreed",
      participantConfidence: analysis.confidence,
    });

    // Auto-book the meeting via schedule agent
    try {
      const bookRes = await fetch(
        new URL("/api/agents/schedule?action=book", req.url),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            slot: neg.proposedSlot,
            participantIds: [neg.requesterUserId, neg.participantUserId],
            confirmed: true,
            title: neg.title,
            threadId: neg.threadId,
            meetingPriority: neg.priority,
            ownerUserId: neg.requesterUserId,
            autoReschedule: true,
          }),
        }
      );

      if (bookRes.ok) {
        const bookData = await bookRes.json();
        await updateNegotiation(neg.negotiationId, {
          state: "booked",
          eventId: bookData.eventId,
          participantConfidence: 1.0,
        });

        return {
          isNegotiation: true,
          negotiationId: neg.negotiationId,
          action: "booked",
          newState: "booked",
          booked: true,
        };
      }
    } catch {
      // Booking failed but negotiation is agreed
    }

    return {
      isNegotiation: true,
      negotiationId: neg.negotiationId,
      action: "agreed",
      newState: "agreed",
      booked: false,
    };
  }

  if (analysis.type === "counter") {
    // Participant wants a different time — find a new slot
    await updateNegotiation(neg.negotiationId, {
      state: "counter",
      participantConfidence: 0.3,
    });

    // Try to find a new slot based on their suggestion
    try {
      const findRes = await fetch(
        new URL("/api/agents/schedule?action=find", req.url),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            participantIds: [neg.requesterUserId, neg.participantUserId],
            preferredTime: analysis.suggestedTime,
            durationMins: neg.durationMins,
            meetingPriority: neg.priority,
          }),
        }
      );

      if (findRes.ok) {
        const findData = await findRes.json();
        const newSlot = findData.slot;

        await updateNegotiation(neg.negotiationId, {
          state: "awaiting_reply",
          proposedSlot: newSlot,
          alternatives: findData.alternatives,
        });

        // Send counter-proposal email
        const updatedNeg = { ...neg, proposedSlot: newSlot };
        void sendCounterEmail(updatedNeg, newSlot).catch(() => {});

        return {
          isNegotiation: true,
          negotiationId: neg.negotiationId,
          action: "counter_sent",
          newState: "awaiting_reply",
          booked: false,
        };
      }
    } catch {
      // Finding new slot failed
    }

    return {
      isNegotiation: true,
      negotiationId: neg.negotiationId,
      action: "counter_received",
      newState: "counter",
      booked: false,
    };
  }

  if (analysis.type === "reject") {
    // Auto-reschedule: search +48h window for a new slot before giving up
    try {
      const rescheduleFrom = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
      const findRes = await fetch(
        new URL("/api/agents/schedule?action=find", req.url),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            participantIds: [neg.requesterUserId, neg.participantUserId],
            preferredTime: rescheduleFrom,
            durationMins: neg.durationMins,
            meetingPriority: neg.priority,
          }),
        }
      );

      if (findRes.ok) {
        const findData = await findRes.json();
        const newSlot = findData.slot;
        if (newSlot) {
          await updateNegotiation(neg.negotiationId, {
            state: "awaiting_reply",
            proposedSlot: newSlot,
            alternatives: findData.alternatives,
            participantConfidence: 0.1,
          });
          const updatedNeg = { ...neg, proposedSlot: newSlot };
          void sendCounterEmail(updatedNeg, newSlot).catch(() => {});
          return {
            isNegotiation: true,
            negotiationId: neg.negotiationId,
            action: "auto_rescheduled",
            newState: "awaiting_reply",
            booked: false,
          };
        }
      }
    } catch {
      // Auto-reschedule failed — fall through to failed state
    }

    await updateNegotiation(neg.negotiationId, {
      state: "failed",
      participantConfidence: 0,
    });

    return {
      isNegotiation: true,
      negotiationId: neg.negotiationId,
      action: "rejected",
      newState: "failed",
      booked: false,
    };
  }

  // Unclear reply — keep waiting
  return {
    isNegotiation: true,
    negotiationId: neg.negotiationId,
    action: "unclear_reply",
    newState: neg.state,
    booked: false,
  };
}

// ── Summarize mailbox ────────────────────────────────────────────────

async function summarizeMailbox(req: NextRequest) {
  const db = await getDb();
  const teamCtx = await resolveTeamAwareness({ fallbackTeamId: "team-1" });
  const recent = await db
    .collection(COLLECTIONS.emails)
    .find({})
    .sort({ receivedAt: -1 })
    .limit(20)
    .toArray();

  if (recent.length === 0) {
    return { summary: "No emails ingested yet.", items: [] };
  }

  const compact = recent.map((m: any) => ({
    from: m.fromEmail,
    subject: m.subject,
    text: String(m.text ?? "").slice(0, 200),
    threadId: m.threadId,
  }));

  let summary = "Mailbox updated.";
  try {
    summary = await lavaChat("neo-chat", [
      {
        role: "system",
        content:
          "Summarize inbox in 3 short sentences: urgent asks, meetings requiring reschedule, and follow-ups.\n" +
          `Team context:\n${teamCtx.orgSummary}`,
      },
      {
        role: "user",
        content: JSON.stringify(compact),
      },
    ]);
  } catch {
    // Keep fallback summary.
  }

  return { summary, items: compact.slice(0, 6) };
}

// ── Send email via Nylas v3 ──────────────────────────────────────────

function resolveRecipientFromRoster(token: string, roster?: string): { email?: string; name?: string } {
  if (!roster || !token) return {};
  const lower = token.toLowerCase();
  const lines = roster.split("\n").filter((l) => l.startsWith("- "));

  for (const line of lines) {
    const raw = line.replace(/^- /, "");
    const parts = raw.split("|").map((p) => p.trim()).filter(Boolean);
    const name = parts[0]?.toLowerCase() ?? "";
    const firstName = name.split(/\s+/)[0] ?? "";
    const email = parts.find((p) => p.includes("@"))?.trim();
    const userId = parts.find((p) => /^[a-z0-9._-]{2,}$/i.test(p) && !p.includes("@"))?.toLowerCase();

    if (
      lower === name ||
      lower === firstName ||
      lower === userId ||
      (email && lower === email.split("@")[0]?.toLowerCase())
    ) {
      return { email, name: parts[0] };
    }
  }
  return {};
}

async function handleSendEmail(body: MailIngestBody) {
  let toEmail = body.toEmail?.trim();
  let recipientName: string | undefined;

  if (!toEmail && body.recipientToken) {
    const resolved = resolveRecipientFromRoster(body.recipientToken, body.orgRoster);
    toEmail = resolved.email;
    recipientName = resolved.name;
  }

  if (!toEmail) {
    return NextResponse.json(
      { error: "Could not resolve recipient email. Provide a direct email address or a name from your org." },
      { status: 400 }
    );
  }

  const subject = body.subject?.trim() || "Message from Neo";
  const emailBody = body.body?.trim() || body.text?.trim() || subject;

  const result = await nylasSendEmail({
    to: [{ email: toEmail, name: recipientName }],
    subject,
    body: emailBody,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: "Failed to send email", details: result.error },
      { status: 500 }
    );
  }

  return NextResponse.json({
    sent: true,
    toEmail,
    recipientName,
    subject,
    messageId: result.messageId,
  });
}

// ── POST /api/agents/mail ────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let body: MailIngestBody;
  try {
    body = (await req.json()) as MailIngestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const action = body.action ?? "ingest";

  if (action === "send") {
    return handleSendEmail(body);
  }

  if (action === "summarize") {
    try {
      const result = await summarizeMailbox(req);
      return NextResponse.json(result);
    } catch (error: any) {
      return NextResponse.json(
        { error: "Failed to summarize mailbox", details: error?.message ?? "unknown" },
        { status: 500 }
      );
    }
  }

  const messageId = body.messageId ?? `mail-${Date.now()}`;
  const threadId = body.threadId ?? `thread-${Date.now()}`;
  const text = body.text ?? "";

  try {
    const db = await getDb();

    await db.collection(COLLECTIONS.emails).updateOne(
      { messageId },
      {
        $set: {
          messageId,
          threadId,
          fromEmail: body.fromEmail?.trim().toLowerCase() ?? "",
          toEmails: (body.toEmails ?? []).map((e) => e.trim().toLowerCase()),
          subject: body.subject ?? "",
          text,
          orgId: body.orgId,
          receivedAt: new Date(body.receivedAt ?? Date.now()),
          createdAt: new Date(),
        },
      },
      { upsert: true }
    );

    // Check if this email is part of an active negotiation
    const negotiationResult = await processNegotiationReply(req, {
      threadId,
      fromEmail: body.fromEmail,
      text,
    }).catch(() => null);

    // Also check for general reschedule reconciliation
    const reconcile = await reconcileLinkedMeetings(req, {
      threadId,
      text,
      fromEmail: body.fromEmail,
      toEmails: body.toEmails,
    });

    return NextResponse.json({
      stored: true,
      messageId,
      threadId,
      rescheduleDetected: hasRescheduleIntent(text),
      reconciled: reconcile,
      negotiation: negotiationResult,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: "Mail ingest failed", details: error?.message ?? "unknown" },
      { status: 500 }
    );
  }
}
