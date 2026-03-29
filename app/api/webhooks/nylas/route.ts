// Nylas webhook handler — calendar + email/thread ingestion
// Calendar events are upserted into neosis.calendars.
// Email/thread updates are forwarded to /api/agents/mail for auto-rescheduling.

import { createHmac, timingSafeEqual } from "crypto";
import { getDb, COLLECTIONS } from "@/lib/mongodb";

interface NylasParticipant {
  email: string;
  name?: string;
}

interface NylasWhen {
  start_time: number;
  end_time: number;
}

interface NylasEventObject {
  id: string;
  account_id?: string;
  title?: string;
  when: NylasWhen;
  participants?: NylasParticipant[];
}

async function getCalendarsCollection() {
  try {
    const db = await getDb();
    return db.collection(COLLECTIONS.calendars);
  } catch {
    return null;
  }
}

function verifyNylasSignature(rawBody: string, signatureHeader: string | null): boolean {
  const secret = process.env.NYLAS_WEBHOOK_SECRET;
  if (!secret) return true;
  if (!signatureHeader) return false;

  const digest = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const expectedVariants = [digest, `sha256=${digest}`];

  for (const expected of expectedVariants) {
    try {
      const a = Buffer.from(expected);
      const b = Buffer.from(signatureHeader);
      if (a.length === b.length && timingSafeEqual(a, b)) return true;
    } catch {
      // keep checking
    }
  }

  return false;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function normalizeEmailPayload(payload: any, type: string) {
  const obj = payload?.data?.object ?? payload?.data ?? payload?.object ?? {};
  const from = asArray<any>(obj.from)
    .map((x) => x?.email)
    .find((x) => typeof x === "string") as string | undefined;
  const to = asArray<any>(obj.to)
    .map((x) => x?.email)
    .filter((x): x is string => typeof x === "string");

  const messageId = String(obj.id ?? obj.message_id ?? `${Date.now()}`);
  const threadId = String(obj.thread_id ?? obj.threadId ?? obj.id ?? `thread-${Date.now()}`);
  const subject = String(obj.subject ?? payload?.subject ?? "");
  const snippet = String(obj.snippet ?? obj.body ?? obj.text ?? payload?.text ?? "");
  const receivedAt = obj.date
    ? new Date(Number(obj.date) * (Number(obj.date) > 9999999999 ? 1 : 1000)).toISOString()
    : new Date().toISOString();

  return {
    action: "ingest" as const,
    sourceType: type,
    messageId,
    threadId,
    fromEmail: from,
    toEmails: to,
    subject,
    text: snippet,
    receivedAt,
  };
}

async function handleCalendarEvent(type: string, payload: any) {
  const obj = payload?.data?.object as NylasEventObject | undefined;
  if (!obj?.id || !obj.when?.start_time || !obj.when?.end_time) {
    return;
  }

  const eventDoc = {
    eventId: obj.id,
    userId: obj.account_id ?? "unknown",
    title: obj.title ?? "Untitled",
    start: new Date(obj.when.start_time * 1000).toISOString(),
    end: new Date(obj.when.end_time * 1000).toISOString(),
    attendees: (obj.participants ?? []).map((p) => p.email),
    attendeeEmails: (obj.participants ?? []).map((p) => p.email),
    createdAt: new Date().toISOString(),
  };

  const col = await getCalendarsCollection();
  if (!col) return;

  if (type === "event.deleted") {
    await col.deleteMany({ eventId: obj.id });
  } else {
    await col.updateOne(
      { eventId: obj.id },
      { $set: eventDoc },
      { upsert: true }
    );
  }
}

export async function POST(req: Request) {
  const raw = await req.text();
  let payload: any;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  const signature = req.headers.get("x-nylas-signature");
  if (!verifyNylasSignature(raw, signature)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const type = String(payload?.type ?? "");
  if (!type) return new Response("OK", { status: 200 });

  try {
    if (type.startsWith("event.")) {
      await handleCalendarEvent(type, payload);
      return new Response("OK", { status: 200 });
    }

    if (type.includes("message") || type.includes("thread")) {
      const mailBody = normalizeEmailPayload(payload, type);
      await fetch(new URL("/api/agents/mail", req.url), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mailBody),
      });
      return new Response("OK", { status: 200 });
    }

    return new Response("OK", { status: 200 });
  } catch {
    // Always ACK webhook to avoid repeated retries. Errors are handled internally.
    return new Response("OK", { status: 200 });
  }
}
