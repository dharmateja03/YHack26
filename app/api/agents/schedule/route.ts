// Agent 3: Neo Sched — meeting negotiator
// Handles: /find /book /cancel /reschedule (POST) and /availability (GET)

import { randomUUID } from "crypto";

interface CalendarEvent {
  eventId: string;
  userId: string;
  title: string;
  start: string;
  end: string;
  attendees: string[];
  createdAt: string;
}

interface TimeSlot {
  start: string;
  end: string;
}

// In-memory store used when MongoDB is unavailable (tests + dev without DB)
const inMemoryCalendars: Map<string, CalendarEvent[]> = new Map();

// Seed mock calendar data for demo / tests
const MOCK_EVENTS: Record<string, CalendarEvent[]> = {
  "user-1": [
    {
      eventId: "mock-ev-1",
      userId: "user-1",
      title: "Team standup",
      start: "2026-03-29T15:00:00Z",
      end: "2026-03-29T15:30:00Z",
      attendees: ["user-1", "user-2"],
      createdAt: new Date().toISOString(),
    },
  ],
  "user-2": [
    {
      eventId: "mock-ev-2",
      userId: "user-2",
      title: "1:1 with EM",
      start: "2026-03-29T16:00:00Z",
      end: "2026-03-29T16:30:00Z",
      attendees: ["user-2"],
      createdAt: new Date().toISOString(),
    },
  ],
};

async function getCalendarsCollection() {
  try {
    if (!process.env.MONGODB_URI) return null;
    const { MongoClient } = await import("mongodb");
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    return client
      .db(process.env.MONGODB_DB ?? "neosis")
      .collection<CalendarEvent>("calendars");
  } catch {
    return null;
  }
}

async function getEventsForUser(userId: string): Promise<CalendarEvent[]> {
  const col = await getCalendarsCollection();
  if (col) {
    return col.find({ userId }).toArray();
  }
  // fallback: in-memory or seeded mock
  return inMemoryCalendars.get(userId) ?? MOCK_EVENTS[userId] ?? [];
}

function isOverlapping(a: TimeSlot, b: TimeSlot): boolean {
  return new Date(a.start) < new Date(b.end) && new Date(b.start) < new Date(a.end);
}

function addMinutes(date: Date, mins: number): Date {
  return new Date(date.getTime() + mins * 60_000);
}

async function findFreeSlot(
  participantIds: string[],
  durationMins: number,
  preferredTime?: string
): Promise<TimeSlot | null> {
  // Build a combined busy list across all participants
  const allEvents: TimeSlot[] = [];
  for (const uid of participantIds) {
    const events = await getEventsForUser(uid);
    allEvents.push(...events.map((e) => ({ start: e.start, end: e.end })));
  }

  // Try Lava/Claude for smart negotiation if API key available
  if (process.env.LAVA_API_KEY) {
    try {
      const prompt = `Given these busy blocks: ${JSON.stringify(allEvents)}, find a ${durationMins}-minute free slot for participants ${participantIds.join(", ")}${preferredTime ? ` preferring around ${preferredTime}` : ""}. Return JSON: {"start": "ISO string", "end": "ISO string"}`;
      const res = await fetch(`${process.env.LAVA_BASE_URL ?? "https://gateway.lava.so/v1"}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.LAVA_API_KEY}`,
          "Content-Type": "application/json",
          "x-lava-agent-id": "neo-sched",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          messages: [{ role: "user", content: prompt }],
          max_tokens: 200,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const content = data.choices?.[0]?.message?.content ?? "";
        const match = content.match(/\{[\s\S]*?\}/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          if (parsed.start && parsed.end) return { start: parsed.start, end: parsed.end };
        }
      }
    } catch {
      // fall through to algorithmic finder
    }
  }

  // Algorithmic fallback: scan from preferred time or next business day 9am
  let cursor = preferredTime ? new Date(preferredTime) : new Date();
  // Round up to next 30-min boundary
  const mins = cursor.getMinutes();
  if (mins !== 0 && mins !== 30) {
    cursor.setMinutes(mins < 30 ? 30 : 60, 0, 0);
  }
  cursor.setSeconds(0, 0);

  for (let i = 0; i < 48; i++) {
    // Skip outside 9am–6pm UTC (simplified)
    const h = cursor.getUTCHours();
    if (h < 9 || h >= 18) {
      cursor = new Date(cursor);
      cursor.setUTCHours(h < 9 ? 9 : 9);
      if (h >= 18) cursor.setUTCDate(cursor.getUTCDate() + 1);
      cursor.setUTCMinutes(0, 0, 0);
    }

    const candidate: TimeSlot = {
      start: cursor.toISOString(),
      end: addMinutes(cursor, durationMins).toISOString(),
    };

    const busy = allEvents.some((e) => isOverlapping(candidate, e));
    if (!busy) return candidate;

    cursor = addMinutes(cursor, 30);
  }

  return null;
}

// ── POST handler ──────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const url = new URL(req.url);
  const path = url.pathname;

  if (path.endsWith("/find")) return handleFind(req);
  if (path.endsWith("/book")) return handleBook(req);
  if (path.endsWith("/cancel")) return handleCancel(req);
  if (path.endsWith("/reschedule")) return handleReschedule(req);

  return Response.json({ error: "Not found" }, { status: 404 });
}

async function handleFind(req: Request) {
  let body: { participantIds?: string[]; preferredTime?: string; durationMins?: number };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { participantIds, preferredTime, durationMins = 30 } = body;

  if (!participantIds || participantIds.length === 0) {
    return Response.json({ error: "participantIds is required and must not be empty" }, { status: 400 });
  }

  const slot = await findFreeSlot(participantIds, durationMins, preferredTime);
  if (!slot) {
    return Response.json({ error: "No available slot found in the next 24 hours" }, { status: 409 });
  }

  return Response.json({
    slot,
    participants: participantIds,
    confirmationRequired: true,
  });
}

async function handleBook(req: Request) {
  let body: { slot?: TimeSlot; participants?: string[]; confirmed?: boolean };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { slot, participants, confirmed } = body;

  if (confirmed !== true) {
    return Response.json(
      { error: "Booking requires confirmed: true. Agent never books automatically." },
      { status: 400 }
    );
  }

  if (!slot?.start || !slot?.end || !participants?.length) {
    return Response.json({ error: "slot and participants are required" }, { status: 400 });
  }

  const eventId = randomUUID();
  const event: CalendarEvent = {
    eventId,
    userId: participants[0],
    title: "Meeting via Neo Sched",
    start: slot.start,
    end: slot.end,
    attendees: participants,
    createdAt: new Date().toISOString(),
  };

  const col = await getCalendarsCollection();
  if (col) {
    await col.insertOne(event);
  } else {
    for (const uid of participants) {
      const existing = inMemoryCalendars.get(uid) ?? [];
      existing.push({ ...event, userId: uid });
      inMemoryCalendars.set(uid, existing);
    }
  }

  // If Nylas token available, create real calendar invite
  const nylasToken = process.env.NYLAS_API_KEY;
  if (nylasToken) {
    try {
      await fetch("https://api.nylas.com/events", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${nylasToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          calendar_id: "primary",
          title: event.title,
          when: { start_time: Math.floor(new Date(slot.start).getTime() / 1000), end_time: Math.floor(new Date(slot.end).getTime() / 1000) },
          participants: participants.map((p) => ({ email: `${p}@team.com` })),
        }),
      });
    } catch {
      // Nylas call is best-effort
    }
  }

  return Response.json({ eventId, slot, participants, booked: true });
}

async function handleCancel(req: Request) {
  let body: { eventId?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.eventId) {
    return Response.json({ error: "eventId is required" }, { status: 400 });
  }

  const col = await getCalendarsCollection();
  if (col) {
    await col.deleteOne({ eventId: body.eventId });
  } else {
    for (const [uid, events] of inMemoryCalendars.entries()) {
      inMemoryCalendars.set(uid, events.filter((e) => e.eventId !== body.eventId));
    }
  }

  return Response.json({ cancelled: true, eventId: body.eventId });
}

async function handleReschedule(req: Request) {
  let body: { eventId?: string; participantIds?: string[]; durationMins?: number; preferredTime?: string; confirmed?: boolean };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { eventId, participantIds, durationMins = 30, preferredTime, confirmed } = body;

  if (!eventId || !participantIds?.length) {
    return Response.json({ error: "eventId and participantIds required" }, { status: 400 });
  }

  const slot = await findFreeSlot(participantIds, durationMins, preferredTime);
  if (!slot) {
    return Response.json({ error: "No available slot found" }, { status: 409 });
  }

  if (confirmed !== true) {
    return Response.json({ slot, participants: participantIds, confirmationRequired: true });
  }

  // Cancel old + book new
  const cancelReq = new Request(req.url, { method: "POST", body: JSON.stringify({ eventId }), headers: { "Content-Type": "application/json" } });
  await handleCancel(cancelReq);

  const bookBody = { slot, participants: participantIds, confirmed: true };
  const bookReq = new Request(req.url, { method: "POST", body: JSON.stringify(bookBody), headers: { "Content-Type": "application/json" } });
  return handleBook(bookReq);
}

// ── GET handler ───────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.pathname.endsWith("/availability")) return handleAvailability(req);
  return Response.json({ error: "Not found" }, { status: 404 });
}

async function handleAvailability(req: Request) {
  const url = new URL(req.url);
  const userId = url.searchParams.get("userId");
  const date = url.searchParams.get("date");

  if (!userId || !date) {
    return Response.json({ error: "userId and date are required" }, { status: 400 });
  }

  const events = await getEventsForUser(userId);
  const dayStart = new Date(`${date}T09:00:00Z`);
  const dayEnd = new Date(`${date}T18:00:00Z`);

  const busyBlocks = events
    .filter((e) => {
      const s = new Date(e.start);
      return s >= dayStart && s < dayEnd;
    })
    .map((e) => ({ start: e.start, end: e.end }));

  // Generate 30-min free slots throughout the day
  const slots: TimeSlot[] = [];
  let cursor = new Date(dayStart);
  while (cursor < dayEnd) {
    const slot: TimeSlot = { start: cursor.toISOString(), end: addMinutes(cursor, 30).toISOString() };
    const busy = busyBlocks.some((b) => isOverlapping(slot, b));
    if (!busy) slots.push(slot);
    cursor = addMinutes(cursor, 30);
  }

  return Response.json({ userId, date, slots });
}
