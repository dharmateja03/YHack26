/**
 * Hermes — The Orchestrator Brain
 *
 * LLM-powered intent router that replaces keyword matching.
 * Gathers required info through multi-turn conversation, then delegates to sub-agents.
 */

import { lavaChat } from "./lava";

// ── Types ────────────────────────────────────────────────────────────

export interface HermesDecision {
  action: "ask" | "delegate" | "chat";
  /** When action is "ask" — the question to ask the user */
  question?: string;
  /** When action is "delegate" — which agent to route to */
  agent?: string;
  endpoint?: string;
  agentAction?: string;
  payload?: Record<string, unknown>;
  /** Data extracted from conversation so far */
  extracted?: Record<string, unknown>;
  /** Which agent we're gathering info for */
  gatheringFor?: string;
  confidence?: number;
}

// Backward-compatible export — schedule route still imports this
export interface HermesScheduleInput {
  participantIds: string[];
  durationMins: number;
  preferredTime?: string;
  busyBlocks: { start: string; end: string }[];
}

/** @deprecated Slot-finding now handled by algorithmic approach in schedule agent. */
export async function findMutualSlotWithHermes(
  _input: HermesScheduleInput
): Promise<{ start: string; end: string } | null> {
  return null;
}

// ── Orchestrator system prompt ───────────────────────────────────────

const HERMES_SYSTEM = `You are Hermes, the orchestrator brain of Neo — an AI executive assistant for engineering teams.

Your job: analyze the user's message in context of the conversation, gather any missing info through natural questions, and delegate to the right sub-agent when you have everything needed.

## Available Agents

1. **neo-sched** (endpoint: "schedule", action: "orchestrate")
   Schedules meetings. REQUIRED before delegating:
   - participants: who to meet with (name or email) — MUST HAVE
   - title: meeting title/topic — default to "Quick sync" if missing
   - preferredTime: when they'd prefer (optional)
   - durationMins: how long in minutes (default 30 if not said)
   - meetingPriority: default 3 if user doesn't specify

2. **neo-pr** (endpoint: "pr", action: "scan")
   PR triage and review routing. Needs: teamId (use default if not specified).

3. **neo-sprint** (endpoint: "sprint", action: "forecast")
   Sprint forecasting and velocity tracking. Needs: teamId.

4. **neo-root** (endpoint: "rootcause")
   Root cause analysis on blocked work. Needs: prId or ticketId (extract from message).

5. **neo-brief** (endpoint: "brief")
   Daily briefings — morning or evening. Needs: userId, type.

6. **neo-mail** (endpoint: "mail", action: "summarize")
   Email/inbox summary. No special params.

## Critical Rules

1. **SCHEDULING**: Ask ONLY for truly missing required data. Do not ask filler questions. Default missing non-critical values instead of blocking.
2. **CONTEXT AWARENESS**: Read the conversation history. If the user already gave info (name, priority, time), extract it — don't re-ask.
3. **PROGRESSIVE EXTRACTION**: As the user answers, accumulate extracted data in the "extracted" field so nothing is lost between turns.
4. **NAME RESOLUTION**: When the user says a first name like "John", put it in participants as-is — the system resolves it to a user ID.
4a. **NO SPELLING QUESTIONS**: Never ask users to spell a teammate's name/email if org roster contains a clear single match by first name, full name, email, or userId.
4b. **YES/NO FOLLOW-UPS**: If user says "yes/no/yeah/no thanks", treat it as answer to the most recent assistant question in the active flow.
5. **GENERAL CHAT**: If the message doesn't need any agent (greetings, general questions, follow-ups on previous data), return action "chat".
6. **BREVITY**: Questions should be 1 sentence. Natural, spoken-friendly. Use contractions.
7. **AVOID LOOPS**: Never ask the same missing field twice if user already answered in prior turns.

## Response Format — STRICT JSON ONLY

When asking a question (need more info):
{"action":"ask","question":"What priority is this — urgent or can it wait a few days?","gatheringFor":"neo-sched","extracted":{"participants":["john"],"title":"sync"},"confidence":0.4}

When ready to delegate (have all required info):
{"action":"delegate","agent":"neo-sched","endpoint":"schedule","agentAction":"orchestrate","payload":{"requesterUserId":"USER_ID","prompt":"original request","participants":[{"userId":"john","priority":4}],"title":"Sprint planning sync","meetingPriority":4,"preferredTime":"tomorrow afternoon","durationMins":30},"confidence":0.9}

When it's general conversation:
{"action":"chat","confidence":1.0}

RESPOND WITH JSON ONLY. No markdown fences, no explanation outside the JSON object.`;

function isLikelyYesNoReply(text: string): boolean {
  const t = text.trim().toLowerCase();
  return /^(yes|yeah|yep|no|nah|no thanks|no thank you|sure|ok|okay)\b/.test(t);
}

function detectActiveScheduleFlow(history: { role: string; content: string }[]): boolean {
  const recent = history.slice(-8);
  const joined = recent.map((t) => t.content.toLowerCase()).join("\n");
  const hasSchedulingTopic = /(schedule|meeting|meet|call|book|reschedule|priority|duration|agenda)/.test(joined);
  const hasQuestion = recent.some((t) => t.role === "assistant" && /\?/.test(t.content));
  return hasSchedulingTopic && hasQuestion;
}

function isSchedulingIntent(text: string): boolean {
  return /\b(schedule|reschedule|book|meeting|call|meet)\b/i.test(text);
}

function normalizeParticipantToken(token: string): string {
  return token
    .trim()
    .toLowerCase()
    .replace(/^[^\w@.+-]+|[^\w@.+-]+$/g, "")
    .replace(/\s+/g, " ");
}

function extractParticipantsFromText(text: string): string[] {
  const out: string[] = [];
  const lower = text.toLowerCase();

  const emails = lower.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g) ?? [];
  out.push(...emails.map(normalizeParticipantToken));

  const withMatches = Array.from(
    lower.matchAll(/\b(?:with|meet(?:ing)? with|call with|schedule with)\s+([a-z0-9@._\-\s,]+?)(?=\s+(?:at|on|today|tomorrow|next|this)\b|$)/gi)
  );
  for (const m of withMatches) {
    const raw = String(m[1] ?? "");
    for (const part of raw.split(/,| and /g)) {
      const cleaned = normalizeParticipantToken(part);
      if (!cleaned || ["uh", "um", "only", "just", "me"].includes(cleaned)) continue;
      out.push(cleaned);
    }
  }

  const ids = lower.match(/\b[a-z]{1,8}\d{2,8}\b/g) ?? [];
  out.push(...ids.map(normalizeParticipantToken));

  return Array.from(new Set(out)).filter(Boolean);
}

function parseClockTime(text: string): { hour: number; minute: number } | null {
  const numeric = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (numeric) {
    let hour = Number(numeric[1]);
    const minute = Number(numeric[2] ?? "0");
    const ap = numeric[3].toLowerCase();
    if (ap === "pm" && hour < 12) hour += 12;
    if (ap === "am" && hour === 12) hour = 0;
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) return { hour, minute };
  }

  const words = text.match(
    /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*(thirty|fifteen|forty[- ]five|twenty|forty|five)?\s*(am|pm)\b/i
  );
  if (!words) return null;
  const hourMap: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
    seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  };
  const minuteMap: Record<string, number> = {
    thirty: 30,
    fifteen: 15,
    "forty-five": 45,
    "forty five": 45,
    twenty: 20,
    forty: 40,
    five: 5,
  };
  let hour = hourMap[words[1].toLowerCase()] ?? 0;
  const minuteKey = String(words[2] ?? "").toLowerCase();
  const minute = minuteKey ? (minuteMap[minuteKey] ?? 0) : 0;
  const ap = words[3].toLowerCase();
  if (ap === "pm" && hour < 12) hour += 12;
  if (ap === "am" && hour === 12) hour = 0;
  return { hour, minute };
}

function extractPreferredTimeIso(texts: string[]): string | undefined {
  for (let i = texts.length - 1; i >= 0; i -= 1) {
    const raw = texts[i];
    const lower = raw.toLowerCase();
    const clock = parseClockTime(raw);
    const hasToday = /\btoday\b/.test(lower);
    const hasTomorrow = /\btomorrow\b/.test(lower);

    if (!clock && !hasToday && !hasTomorrow) continue;

    const d = new Date();
    if (hasTomorrow) d.setDate(d.getDate() + 1);
    if (clock) {
      d.setHours(clock.hour, clock.minute, 0, 0);
      if (!hasToday && !hasTomorrow && d.getTime() < Date.now()) {
        d.setDate(d.getDate() + 1);
      }
    } else {
      d.setHours(10, 0, 0, 0);
    }
    return d.toISOString();
  }
  return undefined;
}

function extractDurationMins(texts: string[]): number | undefined {
  for (let i = texts.length - 1; i >= 0; i -= 1) {
    const m = texts[i].match(/\b(\d{2,3})\s*(min|mins|minutes)\b/i);
    if (!m) continue;
    const n = Number(m[1]);
    if (Number.isFinite(n)) return Math.max(15, Math.min(180, n));
  }
  return undefined;
}

function extractPriority(texts: string[]): number | undefined {
  for (let i = texts.length - 1; i >= 0; i -= 1) {
    const t = texts[i].toLowerCase();
    if (/\bp0\b|urgent|asap|critical/.test(t)) return 5;
    if (/\bp1\b|high priority/.test(t)) return 4;
    if (/\bp2\b/.test(t)) return 3;
    if (/\bp3\b|low priority/.test(t)) return 2;
  }
  return undefined;
}

// ── JSON extraction ──────────────────────────────────────────────────

function extractJson(raw: string): unknown | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    // try other formats
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      // fall through
    }
  }

  const objectMatch = trimmed.match(/\{[\s\S]*\}/);
  if (objectMatch?.[0]) {
    try {
      return JSON.parse(objectMatch[0]);
    } catch {
      return null;
    }
  }

  return null;
}

// ── Main orchestrator entry point ────────────────────────────────────

export async function analyzeIntent(
  message: string,
  conversationHistory: { role: string; content: string }[],
  context?: { userId?: string; teamId?: string; orgRoster?: string }
): Promise<HermesDecision> {
  const userId = context?.userId ?? "user-1";
  const teamId = context?.teamId ?? "team-1";
  const recentUserTexts = conversationHistory
    .filter((t) => t.role === "user")
    .slice(-6)
    .map((t) => t.content);
  const allUserTexts = [...recentUserTexts, message];
  const activeScheduleFlow = detectActiveScheduleFlow(conversationHistory);
  const scheduleNow = activeScheduleFlow || isSchedulingIntent(message) || (isLikelyYesNoReply(message) && detectActiveScheduleFlow(conversationHistory));

  if (scheduleNow) {
    const participants = Array.from(
      new Set(allUserTexts.flatMap((t) => extractParticipantsFromText(t)))
    );
    const preferredTime = extractPreferredTimeIso(allUserTexts);
    const durationMins = extractDurationMins(allUserTexts) ?? 30;
    const meetingPriority = extractPriority(allUserTexts) ?? 3;
    const title = "Quick sync";

    if (participants.length === 0) {
      return {
        action: "ask",
        question: "Who should join this call from your org?",
        gatheringFor: "neo-sched",
        extracted: { preferredTime, durationMins, meetingPriority, title },
        confidence: 0.85,
      };
    }

    return {
      action: "delegate",
      agent: "neo-sched",
      endpoint: "schedule",
      agentAction: "orchestrate",
      payload: {
        requesterUserId: userId,
        teamId,
        prompt: message,
        participants: participants.map((p) =>
          p.includes("@")
            ? { userId: p.split("@")[0], email: p, priority: meetingPriority }
            : { userId: p, priority: meetingPriority }
        ),
        title,
        preferredTime,
        meetingPriority,
        durationMins,
      },
      extracted: { participants, preferredTime, durationMins, meetingPriority, title },
      gatheringFor: "neo-sched",
      confidence: 0.9,
    };
  }

  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: HERMES_SYSTEM },
  ];

  // Include recent conversation so Hermes sees gathered info
  const recent = conversationHistory.slice(-12);
  for (const turn of recent) {
    const role = turn.role === "system" ? "system" : turn.role === "assistant" ? "assistant" : "user";
    messages.push({ role, content: turn.content });
  }

  // Inject user/team context
  messages.push({
    role: "system",
    content: `Current user: ${userId}, team: ${teamId}. Replace USER_ID in payloads with "${userId}" and TEAM_ID with "${teamId}".`,
  });
  if (activeScheduleFlow) {
    messages.push({
      role: "system",
      content:
        "Active scheduling flow detected from prior turns. Continue scheduling intent (ask/delegate), do not switch to general chat.",
    });
    if (isLikelyYesNoReply(message)) {
      messages.push({
        role: "system",
        content: "The latest user message is a yes/no answer to your most recent scheduling question.",
      });
    }
  }

  if (context?.orgRoster?.trim()) {
    messages.push({
      role: "system",
      content:
        `Org roster for name resolution (prefer exact matches by name/email/userId):\n${context.orgRoster}`,
    });
  }

  messages.push({
    role: "user",
    content: message,
  });

  try {
    const raw = await lavaChat("neo-hermes", messages, {
      temperature: 0.12,
      max_tokens: 500,
    });

    const parsed = extractJson(raw);
    if (!parsed || typeof parsed !== "object") {
      return { action: "chat", confidence: 0.3 };
    }

    const d = parsed as Record<string, unknown>;

    const action = d.action as string;
    if (action !== "ask" && action !== "delegate" && action !== "chat") {
      return { action: "chat", confidence: 0.3 };
    }

    // For delegate actions, inject userId/teamId into payload
    let payload = d.payload as Record<string, unknown> | undefined;
    if (action === "delegate" && payload) {
      if (payload.requesterUserId === "USER_ID") payload.requesterUserId = userId;
      if (payload.teamId === "TEAM_ID") payload.teamId = teamId;
      if (!payload.requesterUserId) payload.requesterUserId = userId;
      if (!payload.teamId) payload.teamId = teamId;
      if (d.agent === "neo-sched") {
        if (!payload.durationMins) payload.durationMins = 30;
        if (!payload.meetingPriority) payload.meetingPriority = 3;
        if (!payload.title || typeof payload.title !== "string" || !payload.title.trim()) {
          payload.title = "Quick sync";
        }
      }
    }

    return {
      action,
      question: typeof d.question === "string" ? d.question : undefined,
      agent: typeof d.agent === "string" ? d.agent : undefined,
      endpoint: typeof d.endpoint === "string" ? d.endpoint : undefined,
      agentAction: typeof d.agentAction === "string" ? d.agentAction : undefined,
      payload,
      extracted: d.extracted as Record<string, unknown> | undefined,
      gatheringFor: typeof d.gatheringFor === "string" ? d.gatheringFor : undefined,
      confidence: typeof d.confidence === "number" ? d.confidence : 0.5,
    };
  } catch {
    return { action: "chat", confidence: 0 };
  }
}
