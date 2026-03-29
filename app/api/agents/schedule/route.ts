// Agent 3: Neo Sched — meeting negotiator
// Handles: /find /book /cancel /reschedule /reconcile (POST) and /availability (GET)

import { randomUUID } from "crypto";
import { findMutualSlotWithHermes } from "@/lib/hermes";
import {
  getOrgContextForIdentity,
  getWorkEmailsByUserIds,
  resolveOrgMemberUserId,
} from "@/lib/org";
import { getDb, COLLECTIONS } from "@/lib/mongodb";
import { createNylasEvent } from "@/lib/nylas";

interface CalendarEvent {
  eventId: string;
  userId: string;
  title: string;
  start: string;
  end: string;
  attendees: string[];
  attendeeEmails?: string[];
  createdAt: string;
  orgId?: string;
  threadId?: string;
  threadText?: string;
  autoReschedule?: boolean;
  meetingPriority?: number;
  ownerUserId?: string;
}

interface TimeSlot {
  start: string;
  end: string;
}

interface Participant {
  userId: string;
  email?: string;
  orgId?: string;
  priority: number; // 1(low) to 5(high)
}

interface SlotSelection {
  slot: TimeSlot;
  alternatives: TimeSlot[];
  source: "hermes" | "algorithm";
  score: number;
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

function addMinutes(date: Date, mins: number): Date {
  return new Date(date.getTime() + mins * 60_000);
}

function isOverlapping(a: TimeSlot, b: TimeSlot): boolean {
  return new Date(a.start) < new Date(b.end) && new Date(b.start) < new Date(a.end);
}

function clampPriority(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 3;
  return Math.max(1, Math.min(5, Math.floor(n)));
}

function isEmail(value: string): boolean {
  return value.includes("@");
}

function toUserIdFromEmail(email: string): string {
  return email.split("@")[0] || email;
}

function toOrgFromEmail(email: string): string | undefined {
  const parts = email.split("@");
  return parts[1]?.toLowerCase();
}

function roundUpToHalfHour(date: Date): Date {
  const d = Number.isFinite(date.getTime()) ? new Date(date) : new Date();
  const mins = d.getUTCMinutes();
  if (mins !== 0 && mins !== 30) {
    d.setUTCMinutes(mins < 30 ? 30 : 60, 0, 0);
  }
  d.setUTCSeconds(0, 0);
  return d;
}

function parsePreferredDate(value?: string): Date | null {
  const raw = value?.trim();
  if (!raw) return null;

  const direct = new Date(raw);
  if (Number.isFinite(direct.getTime())) return direct;

  const lower = raw.toLowerCase();
  const hasToday = /\btoday\b/.test(lower);
  const hasTomorrow = /\btomorrow\b/.test(lower);
  const clock = lower.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);

  if (!clock && !hasToday && !hasTomorrow) return null;

  const d = new Date();
  if (hasTomorrow) d.setDate(d.getDate() + 1);

  if (clock) {
    let hour = Number(clock[1]);
    const minute = Number(clock[2] ?? "0");
    const ap = clock[3].toLowerCase();
    if (ap === "pm" && hour < 12) hour += 12;
    if (ap === "am" && hour === 12) hour = 0;
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      d.setHours(hour, minute, 0, 0);
    }
  } else {
    d.setHours(10, 0, 0, 0);
  }

  return Number.isFinite(d.getTime()) ? d : null;
}

function parseMeetingPriorityFromText(text?: string): number {
  if (!text) return 3;
  const t = text.toLowerCase();
  if (t.includes("p0") || t.includes("critical") || t.includes("asap") || t.includes("urgent")) return 5;
  if (t.includes("p1") || t.includes("high priority")) return 4;
  if (t.includes("p2")) return 3;
  if (t.includes("p3") || t.includes("low priority")) return 2;
  return 3;
}

function parseDurationFromText(text?: string): number | undefined {
  if (!text) return undefined;
  const m = text.match(/\b(\d{2,3})\s*(min|mins|minutes)\b/i);
  if (!m) return undefined;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return undefined;
  return Math.max(15, Math.min(180, n));
}

function normalizeParticipants(
  participantIds?: string[],
  participantsRaw?: unknown,
  fallbackOrg?: string
): Participant[] {
  const out: Participant[] = [];

  if (Array.isArray(participantIds)) {
    for (const id of participantIds) {
      if (typeof id === "string" && id.trim()) {
        out.push({ userId: id.trim(), priority: 3, orgId: fallbackOrg });
      }
    }
  }

  if (Array.isArray(participantsRaw)) {
    for (const item of participantsRaw) {
      if (typeof item === "string") {
        if (!item.trim()) continue;
        if (isEmail(item)) {
          out.push({
            userId: toUserIdFromEmail(item),
            email: item,
            orgId: toOrgFromEmail(item) ?? fallbackOrg,
            priority: 3,
          });
        } else {
          out.push({ userId: item.trim(), priority: 3, orgId: fallbackOrg });
        }
        continue;
      }

      if (!item || typeof item !== "object") continue;
      const raw = item as Record<string, unknown>;

      const email = typeof raw.email === "string" ? raw.email.trim() : undefined;
      const rawUserId = typeof raw.userId === "string" ? raw.userId.trim() : "";
      const userId = rawUserId || (email ? toUserIdFromEmail(email) : "");
      if (!userId) continue;

      const orgIdRaw = typeof raw.orgId === "string" ? raw.orgId.trim().toLowerCase() : "";
      out.push({
        userId,
        email,
        priority: clampPriority(raw.priority),
        orgId: orgIdRaw || toOrgFromEmail(email ?? "") || fallbackOrg,
      });
    }
  }

  const dedup = new Map<string, Participant>();
  for (const p of out) {
    const existing = dedup.get(p.userId);
    if (!existing) {
      dedup.set(p.userId, p);
      continue;
    }
    dedup.set(p.userId, {
      userId: p.userId,
      email: p.email ?? existing.email,
      orgId: p.orgId ?? existing.orgId,
      priority: Math.max(existing.priority, p.priority),
    });
  }

  return Array.from(dedup.values());
}

function areSameOrg(participants: Participant[]): boolean {
  const orgs = Array.from(
    new Set(
      participants
        .map((p) => p.orgId)
        .filter((o): o is string => Boolean(o))
    )
  );
  return orgs.length === 1;
}

async function extractParticipantEmails(participants: Participant[], orgId?: string): Promise<string[]> {
  const lookup = await getWorkEmailsByUserIds(participants.map((p) => p.userId));
  const emails = participants.map((p) => p.email || lookup.get(p.userId) || "");
  const missing = participants
    .filter((_, i) => !emails[i])
    .map((p) => p.userId);
  if (missing.length > 0) {
    throw new Error(`missing_emails:${missing.join(",")}`);
  }

  const ccAgent = process.env.NEO_AGENT_EMAIL?.trim();
  if (ccAgent && !emails.includes(ccAgent)) emails.push(ccAgent);

  return Array.from(new Set(emails.filter(Boolean)));
}

function overlapsAny(slot: TimeSlot, busyBlocks: TimeSlot[]): boolean {
  return busyBlocks.some((b) => isOverlapping(slot, b));
}

function scoreSlot(
  slot: TimeSlot,
  participants: Participant[],
  preferredTime?: string,
  sameOrg?: boolean,
  meetingPriority = 3
): number {
  let score = 100;
  const start = new Date(slot.start);
  const hour = start.getUTCHours();

  if (preferredTime) {
    const pref = new Date(preferredTime);
    const diffMins = Math.abs(start.getTime() - pref.getTime()) / 60000;
    score -= diffMins / Math.max(10, meetingPriority * 3);
  }

  // Strongly prefer core work hours.
  if (hour >= 9 && hour < 17) score += 14;
  else if (hour >= 8 && hour < 19) score += 4;
  else score -= 20;

  if (sameOrg) score += 10;

  for (const p of participants) {
    const pr = clampPriority(p.priority);
    if (hour < 9 || hour >= 18) {
      score -= pr * 4;
    }
  }

  return score;
}

async function getCalendarsCollection() {
  try {
    const db = await getDb();
    return db.collection(COLLECTIONS.calendars);
  } catch {
    return null;
  }
}

async function getEventsForUser(userId: string): Promise<CalendarEvent[]> {
  const col = await getCalendarsCollection();
  if (col) {
    return (await col.find({ userId }).toArray()) as CalendarEvent[];
  }
  return inMemoryCalendars.get(userId) ?? MOCK_EVENTS[userId] ?? [];
}

async function getEventById(eventId: string): Promise<CalendarEvent | null> {
  const col = await getCalendarsCollection();
  if (col) {
    return (await col.findOne({ eventId })) as CalendarEvent | null;
  }

  for (const events of inMemoryCalendars.values()) {
    const found = events.find((e) => e.eventId === eventId);
    if (found) return found;
  }
  return null;
}

async function getEventsByThreadId(threadId: string): Promise<CalendarEvent[]> {
  if (!threadId) return [];
  const col = await getCalendarsCollection();
  if (col) {
    return (await col.find({ threadId }).toArray()) as CalendarEvent[];
  }

  const out: CalendarEvent[] = [];
  for (const events of inMemoryCalendars.values()) {
    out.push(...events.filter((e) => e.threadId === threadId));
  }
  return out;
}

function parseMentionsFromText(text?: string): string[] {
  if (!text) return [];
  const lowered = text.toLowerCase();
  const emails = Array.from(new Set(lowered.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g) ?? []));
  const ids = Array.from(new Set(lowered.match(/\b[a-z]{1,6}\d{2,8}\b/g) ?? []));
  const withMatch = lowered.match(/\b(?:with|meet|call with|schedule with)\s+([a-z0-9@._\-\s,]+)/i);
  const namesFromPhrase = (withMatch?.[1] ?? "")
    .split(/,| and /g)
    .map((s) => s.trim())
    .filter(Boolean);
  return Array.from(new Set([...emails, ...ids, ...namesFromPhrase]));
}

async function resolveParticipantsFromContext(input: {
  requesterUserId: string;
  requesterEmail?: string;
  orgId?: string;
  participants?: unknown;
  participantIds?: string[];
  text?: string;
}): Promise<Participant[]> {
  const context = await getOrgContextForIdentity({
    userId: input.requesterUserId,
    email: input.requesterEmail,
  });
  if (!context?.org) {
    const explicit = normalizeParticipants(input.participantIds, input.participants, input.orgId);
    if (explicit.length > 0) {
      // Always ensure the requester is in the list
      const hasRequester = explicit.some((p) => p.userId === input.requesterUserId);
      if (!hasRequester) {
        explicit.unshift({
          userId: input.requesterUserId,
          email: input.requesterEmail,
          priority: 4,
          orgId: input.orgId,
        });
      }
      return explicit;
    }
    return [{ userId: input.requesterUserId, priority: 4, orgId: input.orgId }];
  }

  const orgScope = context.org.slug || context.org.orgId;
  const memberByUserId = new Map(
    context.members.map((m) => [m.userId.toLowerCase(), m] as const)
  );
  const memberByEmail = new Map<string, (typeof context.members)[number]>();
  const memberByNameToken = new Map<string, (typeof context.members)[number]>();

  for (const m of context.members) {
    if (m.workEmail) memberByEmail.set(m.workEmail.toLowerCase(), m);
    if (m.email) memberByEmail.set(m.email.toLowerCase(), m);
    const name = (m.name ?? "").trim().toLowerCase();
    if (name) {
      memberByNameToken.set(name, m);
      const first = name.split(/\s+/)[0];
      if (first) memberByNameToken.set(first, m);
    }
  }

  const participantFromMember = (m: (typeof context.members)[number], priority = 3): Participant => ({
    userId: m.userId,
    email: m.workEmail ?? m.email,
    orgId: m.orgId ?? orgScope,
    priority,
  });

  const explicit = normalizeParticipants(input.participantIds, input.participants, orgScope);
  if (explicit.length > 0) {
    const selected: Participant[] = [participantFromMember(context.me, 4)];
    const seen = new Set<string>([context.me.userId]);

    for (const p of explicit) {
      const normalizedUserId = p.userId.toLowerCase();
      const byUserId = memberByUserId.get(normalizedUserId);
      const byEmail = p.email ? memberByEmail.get(p.email.toLowerCase()) : undefined;
      const byName = memberByNameToken.get(normalizedUserId);
      const m = byUserId ?? byEmail ?? byName;
      if (!m || seen.has(m.userId)) continue;
      seen.add(m.userId);
      selected.push(participantFromMember(m, clampPriority(p.priority)));
    }
    return selected;
  }

  const mentionTokens = parseMentionsFromText(input.text);
  const selected: Participant[] = [participantFromMember(context.me, 4)];
  const seen = new Set<string>([context.me.userId]);

  const members = context.members.filter((m) => m.userId !== context.me.userId);

  for (const token of mentionTokens) {
    const cleaned = token.trim().toLowerCase();
    if (!cleaned) continue;

    const byUserId = memberByUserId.get(cleaned);
    const byEmail = memberByEmail.get(cleaned);
    const byName = memberByNameToken.get(cleaned);
    const m = byUserId ?? byEmail ?? byName;
    if (!m || seen.has(m.userId) || m.userId === context.me.userId) continue;
    seen.add(m.userId);
    selected.push(participantFromMember(m, 3));
  }

  if (selected.length === 1 && members[0]) {
    selected.push(participantFromMember(members[0], 3));
  }

  return selected;
}

async function findBestSlot(
  participants: Participant[],
  durationMins: number,
  preferredTime?: string,
  meetingPriority = 3
): Promise<SlotSelection | null> {
  const ids = participants.map((p) => p.userId);

  const eventsByUser = new Map<string, CalendarEvent[]>();
  await Promise.all(
    ids.map(async (uid) => {
      eventsByUser.set(uid, await getEventsForUser(uid));
    })
  );

  const allBusy: TimeSlot[] = [];
  for (const uid of ids) {
    const events = eventsByUser.get(uid) ?? [];
    allBusy.push(...events.map((e) => ({ start: e.start, end: e.end })));
  }

  // Optional Hermes delegation first.
  const hermesSlot = await findMutualSlotWithHermes({
    participantIds: ids,
    durationMins,
    preferredTime: parsePreferredDate(preferredTime)?.toISOString(),
    busyBlocks: allBusy,
  });

  const sameOrg = areSameOrg(participants);
  const preferredDate = parsePreferredDate(preferredTime);
  const preferredIso = preferredDate?.toISOString();
  const startFrom = roundUpToHalfHour(preferredDate ?? new Date());
  const candidates: Array<{ slot: TimeSlot; score: number }> = [];

  let cursor = new Date(startFrom);
  for (let i = 0; i < 96; i += 1) {
    const h = cursor.getUTCHours();
    if (h < 7 || h >= 21) {
      cursor = addMinutes(cursor, 30);
      continue;
    }

    const slot: TimeSlot = {
      start: cursor.toISOString(),
      end: addMinutes(cursor, durationMins).toISOString(),
    };

    if (!overlapsAny(slot, allBusy)) {
      candidates.push({
        slot,
        score: scoreSlot(slot, participants, preferredIso, sameOrg, meetingPriority),
      });
    }

    cursor = addMinutes(cursor, 30);
  }

  if (candidates.length === 0 && !hermesSlot) return null;

  candidates.sort((a, b) => b.score - a.score);

  const top = candidates.slice(0, 3).map((c) => c.slot);

  if (hermesSlot && !overlapsAny(hermesSlot, allBusy)) {
    const hermesScore = scoreSlot(hermesSlot, participants, preferredIso, sameOrg, meetingPriority) + 3;
    const alternatives = top.filter((s) => s.start !== hermesSlot.start).slice(0, 2);
    return {
      slot: hermesSlot,
      alternatives,
      source: "hermes",
      score: hermesScore,
    };
  }

  const best = candidates[0];
  return {
    slot: best.slot,
    alternatives: candidates.slice(1, 3).map((c) => c.slot),
    source: "algorithm",
    score: best.score,
  };
}

async function persistEventForAllParticipants(
  event: Omit<CalendarEvent, "userId">,
  participantIds: string[]
): Promise<void> {
  const docs: CalendarEvent[] = participantIds.map((uid) => ({ ...event, userId: uid }));
  const col = await getCalendarsCollection();

  if (col) {
    await col.insertMany(docs);
    return;
  }

  for (const uid of participantIds) {
    const existing = inMemoryCalendars.get(uid) ?? [];
    existing.push({ ...event, userId: uid });
    inMemoryCalendars.set(uid, existing);
  }
}

async function createCalendarInvite(
  title: string,
  slot: TimeSlot,
  emails: string[],
  threadText?: string,
  threadId?: string,
  _ownerUserId?: string
): Promise<string | null> {
  try {
    const description = [
      threadId ? `Neo thread: ${threadId}` : "",
      threadText ? `Thread context: ${threadText}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const result = await createNylasEvent({
      title,
      startTime: Math.floor(new Date(slot.start).getTime() / 1000),
      endTime: Math.floor(new Date(slot.end).getTime() / 1000),
      attendeeEmails: emails,
      description,
    });

    return result.id;
  } catch (err) {
    console.error("Nylas event creation failed:", err);
    return null;
  }
}

// ── POST handler ──────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const url = new URL(req.url);
  const path = url.pathname;
  const action = url.searchParams.get("action");

  if (action === "find") return handleFind(req);
  if (action === "book") return handleBook(req);
  if (action === "cancel") return handleCancel(req);
  if (action === "reschedule") return handleReschedule(req);
  if (action === "reconcile") return handleReconcile(req);
  if (action === "orchestrate") return handleOrchestrate(req);

  if (path.endsWith("/find")) return handleFind(req);
  if (path.endsWith("/book")) return handleBook(req);
  if (path.endsWith("/cancel")) return handleCancel(req);
  if (path.endsWith("/reschedule")) return handleReschedule(req);
  if (path.endsWith("/reconcile")) return handleReconcile(req);
  if (path.endsWith("/orchestrate")) return handleOrchestrate(req);

  return Response.json({ error: "Not found" }, { status: 404 });
}

async function handleFind(req: Request) {
  let body: {
    participantIds?: string[];
    participants?: unknown;
    preferredTime?: string;
    durationMins?: number;
    meetingPriority?: number;
    threadText?: string;
    orgId?: string;
  };

  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const participants = normalizeParticipants(body.participantIds, body.participants, body.orgId);
  if (participants.length === 0) {
    return Response.json({ error: "participantIds or participants is required and must not be empty" }, { status: 400 });
  }

  const preferredTime = body.preferredTime;
  const durationMins = Math.max(15, Math.min(180, Number(body.durationMins ?? 30)));
  const meetingPriority = clampPriority(body.meetingPriority);

  const picked = await findBestSlot(participants, durationMins, preferredTime, meetingPriority);
  if (!picked) {
    return Response.json({ error: "No available slot found in the next 48 hours" }, { status: 409 });
  }

  return Response.json({
    slot: picked.slot,
    alternatives: picked.alternatives,
    participants: participants.map((p) => p.userId),
    participantDetails: participants,
    sameOrg: areSameOrg(participants),
    source: picked.source,
    score: picked.score,
    confirmationRequired: true,
  });
}

async function handleOrchestrate(req: Request) {
  let body: {
    requesterUserId?: string;
    requesterEmail?: string;
    participants?: unknown;
    participantIds?: string[];
    orgId?: string;
    prompt?: string;
    title?: string;
    threadId?: string;
    threadText?: string;
    preferredTime?: string;
    meetingPriority?: number;
    durationMins?: number;
  };

  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const requesterUserIdRaw = (body.requesterUserId ?? "user-1").trim();
  const requesterEmail =
    typeof body.requesterEmail === "string" ? body.requesterEmail.trim().toLowerCase() : undefined;
  const requesterUserId =
    (await resolveOrgMemberUserId({ userId: requesterUserIdRaw, email: requesterEmail })) ||
    requesterUserIdRaw;
  const promptText = body.prompt ?? body.threadText ?? "";
  const participants = await resolveParticipantsFromContext({
    requesterUserId,
    requesterEmail,
    orgId: body.orgId,
    participants: body.participants,
    participantIds: body.participantIds,
    text: promptText,
  });

  if (participants.length < 2) {
    const org = await getOrgContextForIdentity({
      userId: requesterUserId,
      email: requesterEmail,
    }).catch(() => null);
    const roster = (org?.members ?? [])
      .map((m) => m.name?.trim() || m.userId)
      .filter(Boolean)
      .slice(0, 12);
    return Response.json(
      {
        error: "I can only schedule with members in your org. Please mention one teammate from your org roster.",
        orgMembers: roster,
      },
      { status: 400 }
    );
  }

  const meetingPriority = clampPriority(body.meetingPriority ?? parseMeetingPriorityFromText(promptText));
  const preferredTime = body.preferredTime;
  const durationMins = Number(body.durationMins ?? parseDurationFromText(promptText) ?? 30);

  const picked = await findBestSlot(
    participants,
    Math.max(15, Math.min(180, durationMins)),
    preferredTime,
    meetingPriority
  );
  if (!picked) {
    return Response.json({ error: "No available slot found in the next 48 hours" }, { status: 409 });
  }

  const threadId = body.threadId ?? `thread-${randomUUID().slice(0, 8)}`;
  const bookReq = new Request(req.url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      slot: picked.slot,
      participants,
      confirmed: true,
      orgId: body.orgId ?? participants.find((p) => p.orgId)?.orgId,
      title: body.title ?? "Priority meeting via Neo",
      threadId,
      threadText: body.threadText ?? body.prompt,
      meetingPriority,
      ownerUserId: requesterUserId,
      autoReschedule: true,
    }),
  });

  const booked = await handleBook(bookReq);
  const bookedJson = await booked.json();
  return Response.json({
    orchestrated: true,
    source: picked.source,
    score: picked.score,
    alternatives: picked.alternatives,
    ...bookedJson,
  });
}

async function handleBook(req: Request) {
  let body: {
    slot?: TimeSlot;
    participants?: unknown;
    participantIds?: string[];
    confirmed?: boolean;
    title?: string;
    orgId?: string;
    threadId?: string;
    threadText?: string;
    autoReschedule?: boolean;
    meetingPriority?: number;
    ownerUserId?: string;
  };

  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const participants = normalizeParticipants(body.participantIds, body.participants, body.orgId);

  if (body.confirmed !== true) {
    return Response.json(
      { error: "Booking requires confirmed: true. Agent never books automatically." },
      { status: 400 }
    );
  }

  if (!body.slot?.start || !body.slot?.end || participants.length === 0) {
    return Response.json({ error: "slot and participants are required" }, { status: 400 });
  }

  const eventId = randomUUID();
  const title = body.title?.trim() || "Meeting via Neo Sched";
  const threadId = body.threadId ?? `thread-${eventId.slice(0, 8)}`;
  const meetingPriority = clampPriority(body.meetingPriority);
  const ownerUserId = body.ownerUserId ?? participants[0]?.userId;
  let attendeeEmails: string[] = [];
  try {
    attendeeEmails = await extractParticipantEmails(participants, body.orgId);
  } catch (error: any) {
    const raw = String(error?.message ?? "");
    const missing = raw.startsWith("missing_emails:")
      ? raw.replace("missing_emails:", "").split(",").filter(Boolean)
      : [];
    return Response.json(
      {
        error:
          missing.length > 0
            ? `Missing email for org member(s): ${missing.join(", ")}. Ask them to set work email in org profile.`
            : "Missing participant email.",
      },
      { status: 400 }
    );
  }

  const eventBase: Omit<CalendarEvent, "userId"> = {
    eventId,
    title,
    start: body.slot.start,
    end: body.slot.end,
    attendees: participants.map((p) => p.userId),
    attendeeEmails,
    createdAt: new Date().toISOString(),
    orgId: body.orgId,
    threadId,
    threadText: body.threadText,
    autoReschedule: body.autoReschedule !== false,
    meetingPriority,
    ownerUserId,
  };

  await persistEventForAllParticipants(eventBase, participants.map((p) => p.userId));

  await createCalendarInvite(title, body.slot, attendeeEmails, body.threadText, threadId, ownerUserId);

  return Response.json({
    eventId,
    slot: body.slot,
    threadId,
    meetingPriority,
    participants: participants.map((p) => p.userId),
    attendeeEmails,
    ccAgent: process.env.NEO_AGENT_EMAIL ?? null,
    booked: true,
  });
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
    await col.deleteMany({ eventId: body.eventId });
  } else {
    for (const [uid, events] of inMemoryCalendars.entries()) {
      inMemoryCalendars.set(uid, events.filter((e) => e.eventId !== body.eventId));
    }
  }

  return Response.json({ cancelled: true, eventId: body.eventId });
}

async function handleReschedule(req: Request) {
  let body: {
    eventId?: string;
    participantIds?: string[];
    participants?: unknown;
    durationMins?: number;
    preferredTime?: string;
    threadText?: string;
    confirmed?: boolean;
    orgId?: string;
    title?: string;
    autoReschedule?: boolean;
  };

  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const existing = body.eventId ? await getEventById(body.eventId) : null;

  let participants = normalizeParticipants(body.participantIds, body.participants, body.orgId);
  if (participants.length === 0 && existing) {
    participants = normalizeParticipants(existing.attendees, existing.attendees, existing.orgId);
  }

  if (!body.eventId || participants.length === 0) {
    return Response.json({ error: "eventId and participants are required" }, { status: 400 });
  }

  const preferredTime = body.preferredTime;
  const durationMins = Math.max(
    15,
    Math.min(
      180,
      Number(
        body.durationMins ??
          (existing
            ? Math.max(15, Math.round((new Date(existing.end).getTime() - new Date(existing.start).getTime()) / 60000))
            : 30)
      )
    )
  );

  const picked = await findBestSlot(participants, durationMins, preferredTime, 4);
  if (!picked) {
    return Response.json({ error: "No available slot found" }, { status: 409 });
  }

  if (body.confirmed !== true) {
    return Response.json({
      slot: picked.slot,
      alternatives: picked.alternatives,
      participants: participants.map((p) => p.userId),
      confirmationRequired: true,
    });
  }

  const cancelReq = new Request(req.url, {
    method: "POST",
    body: JSON.stringify({ eventId: body.eventId }),
    headers: { "Content-Type": "application/json" },
  });
  await handleCancel(cancelReq);

  const bookReq = new Request(req.url, {
    method: "POST",
    body: JSON.stringify({
      slot: picked.slot,
      participants,
      confirmed: true,
      orgId: body.orgId ?? existing?.orgId,
      title: body.title ?? existing?.title,
      threadId: existing?.threadId,
      threadText: body.threadText ?? existing?.threadText,
      autoReschedule: body.autoReschedule ?? existing?.autoReschedule,
      meetingPriority: existing?.meetingPriority,
      ownerUserId: existing?.ownerUserId,
    }),
    headers: { "Content-Type": "application/json" },
  });
  return handleBook(bookReq);
}

async function handleReconcile(req: Request) {
  let body: {
    eventId?: string;
    threadText?: string;
    preferredTime?: string;
    applyDirectly?: boolean;
    durationMins?: number;
  };

  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.eventId) {
    return Response.json({ error: "eventId is required" }, { status: 400 });
  }

  const event = await getEventById(body.eventId);
  if (!event) {
    return Response.json({ error: "event not found" }, { status: 404 });
  }

  const participants = normalizeParticipants(event.attendees, event.attendees, event.orgId);
  if (participants.length === 0) {
    return Response.json({ error: "event has no attendees" }, { status: 400 });
  }

  const preferredTime = body.preferredTime;
  const durationMins = Math.max(
    15,
    Math.min(
      180,
      Number(
        body.durationMins ??
          Math.max(15, Math.round((new Date(event.end).getTime() - new Date(event.start).getTime()) / 60000))
      )
    )
  );

  const picked = await findBestSlot(participants, durationMins, preferredTime, 4);
  if (!picked) {
    return Response.json({ error: "No replacement slot found" }, { status: 409 });
  }

  if (body.applyDirectly !== true) {
    return Response.json({
      eventId: event.eventId,
      proposedSlot: picked.slot,
      alternatives: picked.alternatives,
      participants: participants.map((p) => p.userId),
      requiresApproval: true,
    });
  }

  const cancelReq = new Request(req.url, {
    method: "POST",
    body: JSON.stringify({ eventId: event.eventId }),
    headers: { "Content-Type": "application/json" },
  });
  await handleCancel(cancelReq);

  const bookReq = new Request(req.url, {
    method: "POST",
    body: JSON.stringify({
      slot: picked.slot,
      participants,
      confirmed: true,
      orgId: event.orgId,
      title: event.title,
      threadId: event.threadId,
      threadText: body.threadText ?? event.threadText,
      autoReschedule: true,
      meetingPriority: event.meetingPriority,
      ownerUserId: event.ownerUserId,
    }),
    headers: { "Content-Type": "application/json" },
  });

  const booked = await handleBook(bookReq);
  const bookedJson = await booked.json();

  return Response.json({
    reconciled: true,
    oldEventId: event.eventId,
    ...bookedJson,
  });
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
