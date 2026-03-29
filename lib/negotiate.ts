/**
 * Email negotiation state machine for meeting scheduling.
 *
 * Flow: proposed → awaiting_reply → (counter ↔ awaiting_reply)* → agreed → booked
 *
 * Tracks email threads between Neo and meeting participants,
 * detecting agreement/counter-proposals to auto-book when both sides confirm.
 */

import { getDb, COLLECTIONS } from "./mongodb";

// ── Types ────────────────────────────────────────────────────────────

export type NegotiationState =
  | "proposed"       // Sent initial time proposal to participant
  | "awaiting_reply" // Waiting for participant's email reply
  | "counter"        // Participant counter-proposed a different time
  | "agreed"         // Both sides confirmed
  | "booked"         // Calendar event created
  | "failed";        // Negotiation fell through

export interface NegotiationDoc {
  negotiationId: string;
  threadId: string;
  sessionId: string;
  requesterUserId: string;
  requesterEmail: string;
  participantUserId: string;
  participantEmail: string;
  participantName: string;
  title: string;
  priority: number;
  durationMins: number;
  state: NegotiationState;
  proposedSlot?: { start: string; end: string };
  alternatives?: { start: string; end: string }[];
  counterSlot?: { start: string; end: string };
  requesterConfidence: number;
  participantConfidence: number;
  roundCount: number;
  emailThread: Array<{
    from: string;
    text: string;
    timestamp: Date;
  }>;
  eventId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export const MAX_NEGOTIATION_ROUNDS = 3;

// ── In-memory fallback ───────────────────────────────────────────────

const inMemoryNegotiations = new Map<string, NegotiationDoc>();

async function getCollection() {
  try {
    const db = await getDb();
    return db.collection(COLLECTIONS.negotiations);
  } catch {
    return null;
  }
}

// ── CRUD ─────────────────────────────────────────────────────────────

export async function createNegotiation(
  doc: Omit<NegotiationDoc, "createdAt" | "updatedAt">
): Promise<NegotiationDoc> {
  const full: NegotiationDoc = {
    roundCount: 0,
    ...doc,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const col = await getCollection();
  if (col) {
    await col.insertOne(full as any);
  } else {
    inMemoryNegotiations.set(doc.negotiationId, full);
  }
  return full;
}

export async function getNegotiation(
  negotiationId: string
): Promise<NegotiationDoc | null> {
  const col = await getCollection();
  if (col) {
    const doc = await col.findOne({ negotiationId });
    return doc as unknown as NegotiationDoc | null;
  }
  return inMemoryNegotiations.get(negotiationId) ?? null;
}

export async function getNegotiationByThread(
  threadId: string
): Promise<NegotiationDoc | null> {
  const col = await getCollection();
  if (col) {
    const doc = await col.findOne({ threadId });
    return doc as unknown as NegotiationDoc | null;
  }
  for (const neg of inMemoryNegotiations.values()) {
    if (neg.threadId === threadId) return neg;
  }
  return null;
}

export async function getActiveNegotiationByEmail(
  email: string
): Promise<NegotiationDoc | null> {
  const active: NegotiationState[] = ["proposed", "awaiting_reply", "counter"];
  const normalized = email.toLowerCase();

  const col = await getCollection();
  if (col) {
    const doc = await col.findOne({
      participantEmail: normalized,
      state: { $in: active },
    });
    return doc as unknown as NegotiationDoc | null;
  }

  for (const neg of inMemoryNegotiations.values()) {
    if (neg.participantEmail === normalized && active.includes(neg.state)) {
      return neg;
    }
  }
  return null;
}

export async function updateNegotiation(
  negotiationId: string,
  update: Partial<NegotiationDoc>
): Promise<NegotiationDoc | null> {
  const patch = { ...update, updatedAt: new Date() };

  const col = await getCollection();
  if (col) {
    await col.updateOne({ negotiationId }, { $set: patch });
    const doc = await col.findOne({ negotiationId });
    return doc as unknown as NegotiationDoc | null;
  }

  const existing = inMemoryNegotiations.get(negotiationId);
  if (!existing) return null;
  const updated = { ...existing, ...patch } as NegotiationDoc;
  inMemoryNegotiations.set(negotiationId, updated);
  return updated;
}

export async function addEmailToThread(
  negotiationId: string,
  from: string,
  text: string
): Promise<void> {
  const entry = { from: from.toLowerCase(), text, timestamp: new Date() };

  const col = await getCollection();
  if (col) {
    await col.updateOne(
      { negotiationId },
      { $push: { emailThread: entry } as any, $set: { updatedAt: new Date() } }
    );
    return;
  }

  const existing = inMemoryNegotiations.get(negotiationId);
  if (existing) {
    existing.emailThread.push(entry);
    existing.updatedAt = new Date();
  }
}

// ── Reply analysis ───────────────────────────────────────────────────

/**
 * Extract a human-readable time phrase from reply text.
 * Handles patterns like "3pm", "15:00", "next Tuesday 3pm",
 * "Thursday morning", "tomorrow afternoon", etc.
 */
function extractTimePhraseFromReply(text: string): string | undefined {
  const t = text.toLowerCase();

  // Named day + optional time: "next Tuesday 3pm", "on Friday at 2"
  const namedDay = t.match(
    /(?:next\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:\s+(?:at\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm)?))?/i
  );
  if (namedDay) {
    return namedDay[0].trim();
  }

  // Relative day: "tomorrow at 3pm", "today at 2"
  const relDay = t.match(
    /(?:tomorrow|today|this\s+(?:morning|afternoon|evening))(?:\s+(?:at\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm)?))?/i
  );
  if (relDay) return relDay[0].trim();

  // Time-of-day label: "Thursday morning", "Friday afternoon"
  const timeLabel = t.match(
    /(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+(morning|afternoon|evening)/i
  );
  if (timeLabel) return timeLabel[0].trim();

  // Plain time: "3pm", "14:30", "3:00 pm"
  const plainTime = t.match(/\b(\d{1,2}(?::\d{2})?\s*(?:am|pm))\b/i);
  if (plainTime) return plainTime[1].trim();

  return undefined;
}

export function analyzeReply(text: string): {
  type: "agree" | "counter" | "reject" | "unclear";
  suggestedTime?: string;
  confidence: number;
} {
  const t = text.toLowerCase();

  // Agreement signals
  const agreeSignals = [
    "sounds good", "works for me", "confirmed", "see you then",
    "perfect", "great", "let's do it", "i'm in", "that works",
    "yes", "looks good", "count me in", "i'll be there", "agreed",
    "confirmed", "happy to", "looking forward", "see you at",
    "put it on my calendar", "accepted",
  ];
  const agreeCount = agreeSignals.filter((s) => t.includes(s)).length;
  if (agreeCount > 0) {
    return { type: "agree", confidence: Math.min(1, 0.6 + agreeCount * 0.15) };
  }

  // Hard rejection signals (check before counter to avoid false positives)
  const rejectSignals = [
    "can't make it", "cannot attend", "no longer available",
    "cancel", "decline", "not going to work", "won't work",
    "unable to attend", "can't attend", "i can't",
    "not available", "no thanks", "please cancel",
  ];
  if (rejectSignals.some((s) => t.includes(s))) {
    return { type: "reject", confidence: 0.85 };
  }

  // Counter-proposal signals
  const counterSignals = [
    "how about", "instead", "free at", "available at",
    "works better", "prefer", "can we do", "i'm free after",
    "free after", "busy until", "what about", "rather do",
    "could we", "would", "different time", "another time",
    "later", "earlier", "move it to", "push to",
  ];
  if (counterSignals.some((s) => t.includes(s))) {
    const suggestedTime = extractTimePhraseFromReply(text);
    return {
      type: "counter",
      suggestedTime,
      confidence: suggestedTime ? 0.8 : 0.65,
    };
  }

  // If a time mention is present but no clear counter signal, treat as counter
  const hasTimeMention = extractTimePhraseFromReply(text);
  if (hasTimeMention) {
    return {
      type: "counter",
      suggestedTime: hasTimeMention,
      confidence: 0.6,
    };
  }

  return { type: "unclear", confidence: 0.3 };
}

// ── Auto-reschedule on reject ────────────────────────────────────────

/**
 * Sends a fallback email when MAX_ROUNDS is exceeded, asking participants
 * to coordinate directly.
 */
export async function sendMaxRoundsEmail(neg: NegotiationDoc): Promise<boolean> {
  const nylasKey = process.env.NYLAS_API_KEY;
  if (!nylasKey) return false;

  const senderEmail = process.env.NEO_AGENT_EMAIL ?? "neo-agent@neosis.ai";
  const body = [
    `Hi ${neg.participantName},`,
    "",
    `We've tried to find a mutually convenient time for "${neg.title}" but haven't been able to agree automatically.`,
    "",
    `Please coordinate directly with ${neg.requesterEmail} to schedule this meeting.`,
    "",
    "— Neo (AI Assistant)",
  ].join("\n");

  try {
    const res = await fetch("https://api.nylas.com/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${nylasKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        subject: `Action needed: please schedule "${neg.title}" directly`,
        to: [{ email: neg.participantEmail, name: neg.participantName }],
        from: [{ email: senderEmail, name: "Neo Assistant" }],
        body,
        metadata: { negotiationId: neg.negotiationId, threadId: neg.threadId },
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ── Email sending (best-effort via Nylas) ────────────────────────────

export async function sendProposalEmail(neg: NegotiationDoc): Promise<boolean> {
  const nylasKey = process.env.NYLAS_API_KEY;
  if (!nylasKey) return false;

  const senderEmail = process.env.NEO_AGENT_EMAIL ?? "neo-agent@neosis.ai";
  const slotStart = neg.proposedSlot
    ? new Date(neg.proposedSlot.start).toLocaleString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "TBD";

  const slotEnd = neg.proposedSlot
    ? new Date(neg.proposedSlot.end).toLocaleString("en-US", {
        hour: "numeric",
        minute: "2-digit",
      })
    : "";

  const body = [
    `Hi ${neg.participantName},`,
    "",
    `${neg.requesterEmail.split("@")[0]} would like to schedule "${neg.title}" with you.`,
    "",
    `Proposed time: ${slotStart} – ${slotEnd}`,
    "",
    neg.alternatives?.length
      ? `Alternative slots:\n${neg.alternatives.map((a) => `  • ${new Date(a.start).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`).join("\n")}`
      : "",
    "",
    "Reply to this email to confirm, suggest a different time, or decline.",
    "",
    "— Neo (AI Assistant)",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const res = await fetch("https://api.nylas.com/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${nylasKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        subject: `Meeting Proposal: ${neg.title}`,
        to: [{ email: neg.participantEmail, name: neg.participantName }],
        from: [{ email: senderEmail, name: "Neo Assistant" }],
        body,
        reply_to: [{ email: senderEmail, name: "Neo Assistant" }],
        metadata: {
          negotiationId: neg.negotiationId,
          threadId: neg.threadId,
        },
      }),
    });

    return res.ok;
  } catch {
    return false;
  }
}

export async function sendCounterEmail(
  neg: NegotiationDoc,
  newSlot: { start: string; end: string }
): Promise<boolean> {
  const nylasKey = process.env.NYLAS_API_KEY;
  if (!nylasKey) return false;

  const senderEmail = process.env.NEO_AGENT_EMAIL ?? "neo-agent@neosis.ai";
  const slotStr = new Date(newSlot.start).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  const body = [
    `Hi ${neg.participantName},`,
    "",
    `Thanks for the update. How about ${slotStr} instead?`,
    "",
    "Reply to confirm or suggest another time.",
    "",
    "— Neo (AI Assistant)",
  ].join("\n");

  try {
    const res = await fetch("https://api.nylas.com/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${nylasKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        subject: `Re: Meeting Proposal: ${neg.title}`,
        to: [{ email: neg.participantEmail, name: neg.participantName }],
        from: [{ email: senderEmail, name: "Neo Assistant" }],
        body,
        metadata: {
          negotiationId: neg.negotiationId,
          threadId: neg.threadId,
        },
      }),
    });

    return res.ok;
  } catch {
    return false;
  }
}
