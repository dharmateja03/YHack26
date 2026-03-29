/**
 * Hermes — Deterministic Intent Router
 *
 * Fast, rule-based intent classification that delegates to sub-agents.
 * No LLM in the routing loop — general questions go straight to the
 * chat LLM which already has full context.
 */

// ── Types ────────────────────────────────────────────────────────────

export interface HermesDecision {
  action: "ask" | "delegate" | "chat";
  question?: string;
  agent?: string;
  endpoint?: string;
  agentAction?: string;
  payload?: Record<string, unknown>;
  extracted?: Record<string, unknown>;
  gatheringFor?: string;
  confidence?: number;
}

export interface HermesScheduleInput {
  participantIds: string[];
  durationMins: number;
  preferredTime?: string;
  busyBlocks: { start: string; end: string }[];
}

/** @deprecated Slot-finding handled by algorithmic approach in schedule agent. */
export async function findMutualSlotWithHermes(
  _input: HermesScheduleInput,
): Promise<{ start: string; end: string } | null> {
  return null;
}

// ── Intent detectors ─────────────────────────────────────────────────

function isSchedulingIntent(text: string): boolean {
  return /\b(schedule|reschedule|book|set up a meeting|cancel meeting|cancel the meeting)\b/i.test(text)
    || /\b(meeting|call|sync)\b.*\bwith\b/i.test(text)
    || /\bmeet(?:ing)?\s+with\b/i.test(text);
}

function isPrIntent(text: string): boolean {
  return /\b(pr|pull request|PRs|pull requests|code review|merge|mergeable)\b/i.test(text)
    && /\b(scan|triage|open|status|review|list|check|route|nudge|what|how|tell|show|any)\b/i.test(text);
}

function isSprintIntent(text: string): boolean {
  return /\b(sprint|velocity|forecast|burndown|iteration)\b/i.test(text)
    && /\b(status|how|what|tell|show|looking|track|forecast|progress)\b/i.test(text);
}

function isBriefIntent(text: string): boolean {
  return /\b(brief|briefing|morning brief|daily brief|evening brief|debrief|catch me up|catch up)\b/i.test(text);
}

function isMailIntent(text: string): boolean {
  return /\b(email|inbox|mail|unread|messages)\b/i.test(text)
    && /\b(summary|summarize|check|what|any|show|list|new)\b/i.test(text);
}

function isSendMailIntent(text: string): boolean {
  return (
    /\b(send|write|draft|compose|fire off|shoot)\b/i.test(text)
    && /\b(email|mail|message)\b/i.test(text)
  ) || /\bemail\s+\S+.*\b(about|regarding|saying|that)\b/i.test(text);
}

function isCalendarCheckIntent(text: string): boolean {
  return (
    /\b(calendar|schedule|agenda|events?)\b/i.test(text)
    && /\b(check|show|what|any|today|tomorrow|this week|my|free|busy|open|look)\b/i.test(text)
    && !/\b(schedule|book|set up)\b.*\bwith\b/i.test(text)
  );
}

function isRootCauseIntent(text: string): boolean {
  return /\b(root cause|blocked|why is|what.s blocking|blocker|stuck)\b/i.test(text)
    && /\b(pr-?\d+|tk-?\d+|ticket-?\d+)\b/i.test(text);
}

// ── Scheduling helpers ───────────────────────────────────────────────

function isLikelyYesNoReply(text: string): boolean {
  const t = text.trim().toLowerCase();
  return /^(yes|yeah|yep|no|nah|no thanks|no thank you|sure|ok|okay)\b/.test(t);
}

function detectActiveScheduleFlow(
  history: { role: string; content: string }[],
): boolean {
  const recent = history.slice(-8);
  const joined = recent.map((t) => t.content.toLowerCase()).join("\n");
  const hasSchedulingTopic =
    /(schedule|meeting|meet|call|book|reschedule|priority|duration|agenda)/.test(joined);
  const hasQuestion = recent.some(
    (t) => t.role === "assistant" && /\?/.test(t.content),
  );
  return hasSchedulingTopic && hasQuestion;
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

  const emails =
    lower.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g) ?? [];
  out.push(...emails.map(normalizeParticipantToken));

  const withMatches = Array.from(
    lower.matchAll(
      /\b(?:with|meet(?:ing)? with|call with|schedule with)\s+([a-z0-9@._\-\s,]+?)(?=\s+(?:at|on|today|tomorrow|next|this)\b|$)/gi,
    ),
  );
  for (const m of withMatches) {
    const raw = String(m[1] ?? "");
    for (const part of raw.split(/,| and /g)) {
      const cleaned = normalizeParticipantToken(part);
      if (
        !cleaned ||
        ["uh", "um", "only", "just", "me"].includes(cleaned)
      )
        continue;
      out.push(cleaned);
    }
  }

  const ids = lower.match(/\b[a-z]{1,8}\d{2,8}\b/g) ?? [];
  out.push(...ids.map(normalizeParticipantToken));

  return Array.from(new Set(out)).filter(Boolean);
}

function parseClockTime(
  text: string,
): { hour: number; minute: number } | null {
  const numeric = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (numeric) {
    let hour = Number(numeric[1]);
    const minute = Number(numeric[2] ?? "0");
    const ap = numeric[3].toLowerCase();
    if (ap === "pm" && hour < 12) hour += 12;
    if (ap === "am" && hour === 12) hour = 0;
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59)
      return { hour, minute };
  }

  const words = text.match(
    /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*(thirty|fifteen|forty[- ]five|twenty|forty|five)?\s*(am|pm)\b/i,
  );
  if (!words) return null;
  const hourMap: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
    seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  };
  const minuteMap: Record<string, number> = {
    thirty: 30, fifteen: 15, "forty-five": 45, "forty five": 45,
    twenty: 20, forty: 40, five: 5,
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

// ── Main entry point ─────────────────────────────────────────────────

export async function analyzeIntent(
  message: string,
  conversationHistory: { role: string; content: string }[],
  context?: { userId?: string; teamId?: string; orgRoster?: string },
): Promise<HermesDecision> {
  const userId = context?.userId ?? "user-1";
  const teamId = context?.teamId ?? "team-1";

  const recentUserTexts = conversationHistory
    .filter((t) => t.role === "user")
    .slice(-6)
    .map((t) => t.content);
  const allUserTexts = [...recentUserTexts, message];

  // ── 1. Scheduling ──────────────────────────────────────────────────
  const isOrgTeamQuery = /\b(who(?:'s| is) (?:on |in )?(?:my|our) (?:team|org)|(?:my|our) (?:team|org)|team members|org members|teammates)\b/i.test(message);
  const activeScheduleFlow = detectActiveScheduleFlow(conversationHistory);
  const scheduleNow =
    !isOrgTeamQuery &&
    (activeScheduleFlow ||
    isSchedulingIntent(message) ||
    (isLikelyYesNoReply(message) && activeScheduleFlow));

  if (scheduleNow) {
    const participants = Array.from(
      new Set(allUserTexts.flatMap((t) => extractParticipantsFromText(t))),
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
            : { userId: p, priority: meetingPriority },
        ),
        title,
        preferredTime,
        meetingPriority,
        durationMins,
      },
      extracted: {
        participants, preferredTime, durationMins, meetingPriority, title,
      },
      gatheringFor: "neo-sched",
      confidence: 0.9,
    };
  }

  // ── 2. PR triage ───────────────────────────────────────────────────
  if (isPrIntent(message)) {
    return {
      action: "delegate",
      agent: "neo-pr",
      endpoint: "pr",
      agentAction: "scan",
      payload: { teamId },
      confidence: 0.9,
    };
  }

  // ── 3. Sprint ──────────────────────────────────────────────────────
  if (isSprintIntent(message)) {
    return {
      action: "delegate",
      agent: "neo-sprint",
      endpoint: "sprint",
      agentAction: "forecast",
      payload: { teamId },
      confidence: 0.9,
    };
  }

  // ── 4. Brief ───────────────────────────────────────────────────────
  if (isBriefIntent(message)) {
    return {
      action: "delegate",
      agent: "neo-brief",
      endpoint: "brief",
      payload: { userId, type: "morning" },
      confidence: 0.9,
    };
  }

  // ── 5. Calendar check ──────────────────────────────────────────────
  if (isCalendarCheckIntent(message)) {
    const hasTomorrow = /\btomorrow\b/i.test(message);
    const day = hasTomorrow ? "tomorrow" : "today";
    return {
      action: "delegate",
      agent: "neo-sched",
      endpoint: "schedule",
      agentAction: "calendar",
      payload: { userId, day },
      confidence: 0.9,
    };
  }

  // ── 6a. Send mail ──────────────────────────────────────────────────
  if (isSendMailIntent(message)) {
    const emailMatch = message.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
    const toEmail = emailMatch?.[0];

    const aboutMatch = message.match(/\b(?:about|regarding|saying|that|with subject)\s+["']?(.+?)["']?\s*$/i);
    const subject = aboutMatch?.[1]?.slice(0, 120);

    // Resolve recipient from org roster if mentioned by name
    const withMatch = message.match(/\b(?:to|email)\s+([a-z][a-z0-9._-]*)/i);
    const recipientToken = toEmail ? undefined : withMatch?.[1]?.toLowerCase();

    if (!toEmail && !recipientToken) {
      return {
        action: "ask",
        question: "Who do you want me to email? You can give me a name from your org or an email address.",
        gatheringFor: "neo-mail-send",
        extracted: { subject },
        confidence: 0.85,
      };
    }

    if (!subject) {
      return {
        action: "ask",
        question: `What should the email to ${toEmail || recipientToken} be about?`,
        gatheringFor: "neo-mail-send",
        extracted: { toEmail, recipientToken },
        confidence: 0.85,
      };
    }

    return {
      action: "delegate",
      agent: "neo-mail",
      endpoint: "mail",
      agentAction: "send",
      payload: {
        userId,
        toEmail,
        recipientToken,
        subject,
        body: subject,
        orgRoster: context?.orgRoster,
      },
      confidence: 0.9,
    };
  }

  // ── 5b. Mail summary ──────────────────────────────────────────────
  if (isMailIntent(message)) {
    return {
      action: "delegate",
      agent: "neo-mail",
      endpoint: "mail",
      agentAction: "summarize",
      payload: { userId },
      confidence: 0.9,
    };
  }

  // ── 6. Root cause ──────────────────────────────────────────────────
  if (isRootCauseIntent(message)) {
    const prId = message.match(/\b(pr-?\d+)\b/i)?.[1];
    const ticketId = message.match(/\b(tk-?\d+|ticket-?\d+)\b/i)?.[1];
    return {
      action: "delegate",
      agent: "neo-root",
      endpoint: "rootcause",
      payload: { prId, ticketId, teamId },
      confidence: 0.85,
    };
  }

  // ── 7. Everything else → general chat ──────────────────────────────
  return { action: "chat", confidence: 1.0 };
}
