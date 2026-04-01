import { NextRequest, NextResponse } from "next/server";
import { getDb, COLLECTIONS } from "@/lib/mongodb";
import { lavaChat } from "@/lib/lava";
import { streamSpeech } from "@/lib/elevenlabs";
import { saveTurn, buildConversationContext } from "@/lib/memory";
import { analyzeIntent, HermesDecision } from "@/lib/hermes";
import { getOrgContextForIdentity, resolveOrgMemberUserId } from "@/lib/org";
import { getSessionUser } from "@/lib/current-user";
import { getSqliteDbSafe } from "@/lib/sqlite";
import {
  createNegotiation,
  sendProposalEmail,
  NegotiationDoc,
} from "@/lib/negotiate";
import { buildInvolvementContext } from "@/lib/team-graph";
import { randomUUID } from "crypto";

// ── System prompt for final response generation ──────────────────────

const SYSTEM_PROMPT = `You are Neo, an AI executive assistant for engineering teams built by Neosis.

You help engineers with:
- Daily briefings (PRs, tickets, blockers, calendar)
- PR triage and review routing
- Meeting scheduling
- Root cause analysis on blocked work
- Sprint forecasting

Personality:
- Concise and direct — 2-3 sentences max per response
- Sound natural when spoken out loud: contractions, simple phrasing, no bullet lists
- Cite specifics: PR numbers, ticket IDs, people's names
- If you don't have data, say so — never make up specifics
- Sound like a sharp engineering lead, not a chatbot
- Remember what the user said earlier in this conversation and reference it naturally

When the user asks about something you helped with before, reference that context.
When the user follows up on a topic, don't re-explain — build on what was already said.`;

// ── Helpers ──────────────────────────────────────────────────────────

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs)
    ),
  ]);
}

function toSpokenStyle(text: string): string {
  const cleaned = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[`*_>#-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return "";

  const sentences = (cleaned.match(/[^.!?]+[.!?]?/g) ?? [cleaned])
    .map((s) => s.trim())
    .filter(Boolean);

  return sentences.slice(0, 8).join(" ");
}

const TEAM_OVERVIEW_INTENT =
  /\b(tell me about (?:my|our) (?:team(?:mates)?|org(?:anization)?)|who(?:'s| is) (?:on |in )?(?:my|our) (?:team(?:mates)?|org(?:anization)?)|team members|teammates|org members|my team|our team|my org|our org|my teammates|our teammates|who(?:'s| is) in (?:the )?org)\b/i;

interface ParsedRosterMember {
  name?: string;
  userId?: string;
  email?: string;
  role?: string;
  aliases: string[];
}

function parseRosterMembers(orgRosterContext: string): ParsedRosterMember[] {
  const lines = orgRosterContext
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("- "));

  const out: ParsedRosterMember[] = [];
  for (const line of lines) {
    const raw = line.replace(/^- /, "");
    const parts = raw.split("|").map((p) => p.trim()).filter(Boolean);
    if (parts.length === 0) continue;

    let name: string | undefined;
    let userId: string | undefined;
    let email: string | undefined;
    let role: string | undefined;

    for (const part of parts) {
      const lower = part.toLowerCase();
      if (lower === "manager" || lower === "member") {
        role = lower;
        continue;
      }
      if (part.includes("@")) {
        email = lower;
        continue;
      }
      if (!userId && /^[a-z0-9._-]{2,}$/i.test(part)) {
        userId = part;
      }
      if (!name) name = part;
    }

    const aliases = new Set<string>();
    if (name) {
      aliases.add(name.toLowerCase());
      const first = name.toLowerCase().split(/\s+/)[0];
      if (first) aliases.add(first);
    }
    if (userId) aliases.add(userId.toLowerCase());
    if (email) {
      aliases.add(email.toLowerCase());
      const local = email.split("@")[0]?.toLowerCase();
      if (local) aliases.add(local);
    }

    out.push({
      name,
      userId,
      email,
      role,
      aliases: Array.from(aliases).filter((a) => a.length >= 2),
    });
  }

  return out;
}

function buildMemberOverviewReply(message: string, orgRosterContext: string): string | null {
  const text = orgRosterContext.trim();
  if (!text) return null;

  const wantsMemberDetail =
    /\b(tell me about|who(?:'s| is)|describe|info on)\b/i.test(message) &&
    !/\b(working on|assigned|blocked|last time|talked|previous|before)\b/i.test(message);
  if (!wantsMemberDetail) return null;

  const members = parseRosterMembers(text);
  if (members.length === 0) return null;

  const lower = message.toLowerCase();
  const matched = members.filter((m) => m.aliases.some((a) => lower.includes(a)));
  if (matched.length === 0) return null;

  const summary = matched.slice(0, 2).map((m) => {
    const label = m.name || m.userId || "teammate";
    const parts = [
      m.role ? `${m.role}` : "member",
      m.userId ? `id ${m.userId}` : null,
      m.email ? m.email : null,
    ].filter(Boolean);
    return `${label}: ${parts.join(", ")}`;
  });

  return `From your org roster: ${summary.join("; ")}.`;
}

function buildBookedScheduleReply(agentData: any, requesterEmail?: string): string | null {
  if (!agentData?.booked || !agentData?.slot?.start) return null;
  const start = new Date(String(agentData.slot.start));
  const when = Number.isFinite(start.getTime())
    ? start.toLocaleString("en-US", {
        weekday: "short",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      })
    : "the selected time";

  const allEmails: string[] = Array.isArray(agentData.attendeeEmails)
    ? agentData.attendeeEmails.map((e: unknown) => String(e || "").trim().toLowerCase()).filter(Boolean)
    : [];
  const participantEmails = allEmails.filter(
    (e) => e !== requesterEmail?.trim().toLowerCase() && e !== process.env.NEO_AGENT_EMAIL?.trim().toLowerCase()
  );
  const emailText = participantEmails.length > 0 ? participantEmails.join(", ") : "your teammates";

  return `Booked. The meeting is set for ${when}, and I sent the invite to ${emailText}.`;
}

function buildTeamOverviewReply(orgRosterContext: string): string | null {
  const text = orgRosterContext.trim();
  if (!text) return null;

  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const orgLine = lines.find((l) => l.toLowerCase().startsWith("organization:")) ?? "";
  const orgName = orgLine.replace(/^organization:\s*/i, "") || "your org";
  const members = lines
    .filter((l) => l.startsWith("- "))
    .map((l) => l.replace(/^- /, ""))
    .slice(0, 6);

  if (members.length === 0) {
    return `I can see you're in ${orgName}, but I don't have team member entries yet.`;
  }

  return `You're in ${orgName}. I currently know ${members.length} teammate${members.length === 1 ? "" : "s"}: ${members.join("; ")}.`;
}

// ── Fetch live data for context ──────────────────────────────────────

async function getLiveContext(userId: string, teamId: string): Promise<string> {
  const buildSqliteContext = async (): Promise<string> => {
    const sqlite = await getSqliteDbSafe();
    if (!sqlite) return "";

    const prs = sqlite
      .prepare(
        `SELECT pr_id AS prId, title, author, assignee, checks, approvals, required_approvals AS requiredApprovals
         FROM prs WHERE team_id = ? AND state = 'open' ORDER BY updated_at DESC LIMIT 10`
      )
      .all(teamId) as Array<Record<string, unknown>>;
    const tickets = sqlite
      .prepare(
        `SELECT ticket_id AS ticketId, title, priority, status, assignee, blocked_by_json AS blockedBy
         FROM tickets WHERE team_id = ? ORDER BY updated_at DESC LIMIT 10`
      )
      .all(teamId) as Array<Record<string, unknown>>;

    const parts: string[] = [];
    if (prs.length > 0) {
      parts.push(
        "Open PRs: " +
          prs
            .map(
              (p) =>
                `${p.prId} "${p.title}" by ${p.author ?? "unknown"} assigned:${p.assignee ?? "unassigned"} (${p.checks ?? "unknown"}, ${p.approvals ?? 0}/${p.requiredApprovals ?? 1} approvals)`
            )
            .join("; ")
      );
    }
    if (tickets.length > 0) {
      parts.push(
        "Tickets: " +
          tickets
            .map((t) => {
              let blockedBy: string[] = [];
              try {
                blockedBy = JSON.parse(String(t.blockedBy ?? "[]"));
              } catch {}
              return `${t.ticketId} "${t.title}" P${t.priority ?? 3} [${t.status ?? "Open"}] assigned:${t.assignee ?? "unassigned"}${blockedBy.length ? ` blocked by ${blockedBy.join(",")}` : ""}`;
            })
            .join("; ")
      );
    }
    return parts.join("\n");
  };

  try {
    const db = await getDb();
    const [prs, tickets, sprint] = await Promise.all([
      db.collection(COLLECTIONS.prs).find({ teamId, state: "open" }).limit(10).toArray(),
      db.collection(COLLECTIONS.tickets).find({ teamId }).sort({ priority: 1 }).limit(10).toArray(),
      db.collection(COLLECTIONS.sprints).findOne({ teamId }),
    ]);

    const parts: string[] = [];

    if (prs.length > 0) {
      parts.push(
        "Open PRs: " +
          prs
            .map(
              (p) =>
                `${p.prId} "${p.title}" by ${p.author} assigned:${p.assignee ?? "unassigned"} (${p.checks}, ${p.approvals}/${p.requiredApprovals} approvals)`
            )
            .join("; ")
      );
    }
    if (tickets.length > 0) {
      parts.push(
        "Tickets: " +
          tickets
            .map(
              (t) =>
                `${t.ticketId} "${t.title}" P${t.priority} [${t.status}] assigned:${t.assignee ?? "unassigned"}${t.blockedBy?.length ? ` blocked by ${t.blockedBy.join(",")}` : ""}`
            )
            .join("; ")
      );
    }
    if (sprint) {
      const stories = sprint.stories ?? [];
      const done = stories.filter((s: any) => s.status === "done").length;
      const blocked = stories.filter((s: any) => s.status === "blocked").length;
      parts.push(
        `Sprint "${sprint.name}": ${done}/${stories.length} stories done, ${blocked} blocked, velocity ${sprint.velocity}`
      );
    }

    // Supplement from SQL tables if docs-based query missed PRs or tickets
    if (prs.length === 0 || tickets.length === 0) {
      const sqliteCtx = await buildSqliteContext().catch(() => "");
      if (sqliteCtx) parts.push(sqliteCtx);
    }

    if (parts.length > 0) return parts.join("\n");

    return "No live data available.";
  } catch {
    try {
      const sqliteCtx = await buildSqliteContext();
      return sqliteCtx || "Database unavailable — responding from memory only.";
    } catch {
      return "Database unavailable — responding from memory only.";
    }
  }
}

async function getOrgRosterContext(userId: string, email?: string): Promise<string> {
  try {
    const context = await getOrgContextForIdentity({ userId, email });
    if (!context?.org) return "";

    const members = context.members
      .slice(0, 40)
      .map((m) => {
        const identity = [
          m.name?.trim(),
          m.userId,
          m.workEmail?.trim() || m.email?.trim(),
          m.role,
        ]
          .filter(Boolean)
          .join(" | ");
        return `- ${identity}`;
      });

    const me = [context.me.name?.trim(), context.me.userId, context.me.workEmail?.trim() || context.me.email?.trim()]
      .filter(Boolean)
      .join(" | ");

    return [
      `Organization: ${context.org.name} (${context.org.slug || context.org.orgId})`,
      `Current user: ${me}`,
      "Team members:",
      ...members,
    ].join("\n");
  } catch {
    return "";
  }
}

async function pickBestRequesterUserId(input: {
  sessionUserId?: string;
  sessionEmail?: string;
  bodyUserId?: string;
}): Promise<string> {
  const masterUserId = process.env.MASTER_USER_ID?.trim() || "user-1";
  const sessionRaw = input.sessionUserId?.trim();
  const bodyRaw = input.bodyUserId?.trim();

  const sessionResolved = sessionRaw
    ? (await resolveOrgMemberUserId({
        userId: sessionRaw,
        email: input.sessionEmail,
      })) || sessionRaw
    : undefined;

  const bodyResolved = bodyRaw
    ? (await resolveOrgMemberUserId({
        userId: bodyRaw,
      })) || bodyRaw
    : undefined;

  if (sessionResolved && bodyResolved && sessionResolved !== bodyResolved) {
    const [sessionOrg, bodyOrg] = await Promise.all([
      getOrgContextForIdentity({ userId: sessionResolved, email: input.sessionEmail }).catch(() => null),
      getOrgContextForIdentity({ userId: bodyResolved }).catch(() => null),
    ]);
    if (bodyOrg && !sessionOrg) return bodyResolved;
    if (bodyOrg && sessionOrg && bodyResolved !== "user-1") return bodyResolved;
  }

  const picked = sessionResolved || bodyResolved || masterUserId;

  // If the resolved user doesn't belong to any org, fall back to master user
  const org = await getOrgContextForIdentity({ userId: picked, email: input.sessionEmail }).catch(() => null);
  if (!org && process.env.ENABLE_MASTER_FALLBACK === "true") return masterUserId;

  return picked;
}

// ── Post-delegation: start email negotiation if scheduling ───────────

async function maybeStartNegotiation(
  decision: HermesDecision,
  agentData: any,
  sessionId: string,
  userId: string,
  requesterEmailFromSession?: string
): Promise<{ started: boolean; negotiation?: NegotiationDoc }> {
  // Only trigger for scheduling delegations that returned a booked slot
  if (decision.agent !== "neo-sched" || !agentData?.slot || !agentData?.booked) {
    return { started: false };
  }

  // Find participant email (not the requester)
  const attendeeEmails: string[] = agentData.attendeeEmails ?? [];
  const requesterEmail =
    requesterEmailFromSession?.trim() ||
    process.env.MASTER_USER_EMAIL ||
    `${userId}@neosis.ai`;
  const participantEmail = attendeeEmails.find(
    (e: string) =>
      e !== requesterEmail && e !== process.env.NEO_AGENT_EMAIL
  );

  if (!participantEmail) return { started: false };

  const participants: string[] = agentData.participants ?? [];
  const participantUserId =
    participants.find((p: string) => p !== userId) ?? participantEmail.split("@")[0];

  const payload = decision.payload ?? {};
  const negotiationId = `neg-${randomUUID().slice(0, 8)}`;
  const threadId = agentData.threadId ?? `thread-${negotiationId}`;

  const neg = await createNegotiation({
    negotiationId,
    threadId,
    sessionId,
    requesterUserId: userId,
    requesterEmail,
    participantUserId,
    participantEmail,
    participantName: (payload.participants as any)?.[0]?.userId ?? participantUserId,
    title: (payload.title as string) ?? agentData.title ?? "Meeting via Neo",
    priority: (payload.meetingPriority as number) ?? 3,
    durationMins: (payload.durationMins as number) ?? 30,
    state: "proposed",
    proposedSlot: agentData.slot,
    alternatives: agentData.alternatives,
    requesterConfidence: 1.0,
    participantConfidence: 0,
    roundCount: 0,
    emailThread: [],
    eventId: agentData.eventId,
  });

  // Send the proposal email (best-effort)
  void sendProposalEmail(neg).catch(() => {});

  return { started: true, negotiation: neg };
}

// ── POST /api/agents/chat ────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const wantsAudio = (req.headers.get("accept") ?? "").includes("audio/mpeg");

  let body: { message: string; sessionId: string; userId?: string; teamId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { message, sessionId } = body;
  const sessionUser = await getSessionUser();
  const userId = await pickBestRequesterUserId({
    sessionUserId: sessionUser?.userId,
    sessionEmail: sessionUser?.email,
    bodyUserId: body.userId,
  });

  if (!message || !sessionId) {
    return NextResponse.json({ error: "message and sessionId required" }, { status: 400 });
  }

  // 1. Save user turn (non-blocking)
  void saveTurn(sessionId, userId, "user", message).catch(() => {});

  // 2. Resolve org context first so we can derive teamId from org slug
  const orgRosterContext = await getOrgRosterContext(userId, sessionUser?.email).catch(() => "");

  // Extract the org slug from roster context to use as teamId (matches seeded data)
  let teamId = body.teamId ?? "team-1";
  const slugMatch = orgRosterContext.match(/\(([^)]+)\)/);
  if (slugMatch?.[1]) teamId = slugMatch[1];

  // 3. Build remaining context in parallel
  const [conversationHistory, liveContext, teamGraphContext] = await Promise.all([
    buildConversationContext(sessionId, userId, message).catch(
      () => [] as { role: "user" | "assistant" | "system"; content: string }[]
    ),
    getLiveContext(userId, teamId).catch(
      () => "Database unavailable — responding from memory only."
    ),
    buildInvolvementContext(userId, message).catch(() => ""),
  ]);

  const memberOverviewReply = buildMemberOverviewReply(message, orgRosterContext);
  if (memberOverviewReply) {
    void saveTurn(sessionId, userId, "assistant", memberOverviewReply, "neo-chat").catch(() => {});

    if (wantsAudio) {
      try {
        const audioStream = await withTimeout(streamSpeech(memberOverviewReply), 15000);
        return new Response(audioStream, {
          headers: {
            "Content-Type": "audio/mpeg",
            "X-Neo-Reply": encodeURIComponent(memberOverviewReply),
            "X-Neo-Agent": "neo-chat",
            "Cache-Control": "no-store",
          },
        });
      } catch {
        // Fall through to JSON.
      }
    }

    return NextResponse.json({
      reply: memberOverviewReply,
      agent: "neo-chat",
      data: null,
      sessionId,
    });
  }

  const teamOverviewReply = TEAM_OVERVIEW_INTENT.test(message)
    ? buildTeamOverviewReply(orgRosterContext)
    : null;

  if (teamOverviewReply) {
    void saveTurn(sessionId, userId, "assistant", teamOverviewReply, "neo-chat").catch(() => {});

    if (wantsAudio) {
      try {
        const audioStream = await withTimeout(streamSpeech(teamOverviewReply), 15000);
        return new Response(audioStream, {
          headers: {
            "Content-Type": "audio/mpeg",
            "X-Neo-Reply": encodeURIComponent(teamOverviewReply),
            "X-Neo-Agent": "neo-chat",
            "Cache-Control": "no-store",
          },
        });
      } catch {
        // Fall through to JSON.
      }
    }

    return NextResponse.json({
      reply: teamOverviewReply,
      agent: "neo-chat",
      data: null,
      sessionId,
    });
  }

  // 3. Ask Hermes what to do
  // Only pass actual session turns to Hermes (exclude recalled-memory system turns)
  // so past-session context doesn't pollute intent detection
  const sessionTurnsOnly = conversationHistory.filter((t) => t.role !== "system");
  const combinedOrgContext = [orgRosterContext, teamGraphContext].filter(Boolean).join("\n\n");
  let decision: HermesDecision;
  try {
    decision = await withTimeout(
      analyzeIntent(message, sessionTurnsOnly, {
        userId,
        teamId,
        orgRoster: combinedOrgContext || undefined,
      }),
      8000
    );
  } catch {
    // Hermes timed out — fall through to general chat
    decision = { action: "chat", confidence: 0 };
  }

  // ── ACTION: ASK (Hermes needs more info) ────────────────────────
  if (decision.action === "ask" && decision.question) {
    const reply = decision.question;

    // Save the question as assistant turn
    void saveTurn(sessionId, userId, "assistant", reply, "neo-hermes").catch(() => {});

    // Return audio or JSON
    if (wantsAudio && reply.length > 0) {
      try {
        const audioStream = await withTimeout(streamSpeech(reply), 15000);
        return new Response(audioStream, {
          headers: {
            "Content-Type": "audio/mpeg",
            "X-Neo-Reply": encodeURIComponent(reply),
            "X-Neo-Agent": "neo-hermes",
            "X-Neo-Gathering": decision.gatheringFor ?? "",
            "Cache-Control": "no-store",
          },
        });
      } catch {
        // Fall through to JSON
      }
    }

    return NextResponse.json({
      reply,
      agent: "neo-hermes",
      gatheringFor: decision.gatheringFor,
      extracted: decision.extracted,
      data: null,
      sessionId,
    });
  }

  // ── ACTION: DELEGATE (Hermes routes to a sub-agent) ─────────────
  let agentUsed = "neo-chat";
  let agentData: any = null;

  if (decision.action === "delegate" && decision.endpoint) {
    agentUsed = decision.agent ?? "neo-chat";
    try {
      const actionQuery = decision.agentAction ? `?action=${decision.agentAction}` : "";
      const payload = { ...(decision.payload ?? {}) } as Record<string, unknown>;
      if (decision.agent === "neo-sched") {
        if (!payload.requesterUserId) payload.requesterUserId = userId;
        if (sessionUser?.email && !payload.requesterEmail) {
          payload.requesterEmail = sessionUser.email;
        }
      }
      const agentRes = await withTimeout(
        fetch(
          new URL(`/api/agents/${decision.endpoint}${actionQuery}`, req.url),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          }
        ),
        10000
      );
      const body = await agentRes.json().catch(() => null);
      if (agentRes.ok) {
        agentData = body;
      } else {
        agentData = {
          error: body?.error || `Agent ${decision.endpoint} failed`,
          ...body,
          status: agentRes.status,
        };
      }
    } catch {
      // Sub-agent failed — continue with conversational fallback
    }
  }

  // 4. Check if we should start a negotiation (scheduling flow)
  let negotiationInfo: { started: boolean; negotiation?: NegotiationDoc } = {
    started: false,
  };
  if (agentData && decision.action === "delegate") {
    negotiationInfo = await maybeStartNegotiation(
      decision,
      agentData,
      sessionId,
      userId,
      sessionUser?.email
    ).catch(() => ({ started: false }));
  }

  if (decision.agent === "neo-sched" && agentData?.booked) {
    const bookedReply =
      buildBookedScheduleReply(agentData, sessionUser?.email) ||
      "Booked. Your meeting invite has been sent.";
    void saveTurn(sessionId, userId, "assistant", bookedReply, "neo-sched").catch(() => {});

    if (wantsAudio) {
      try {
        const audioStream = await withTimeout(streamSpeech(bookedReply), 15000);
        return new Response(audioStream, {
          headers: {
            "Content-Type": "audio/mpeg",
            "X-Neo-Reply": encodeURIComponent(bookedReply),
            "X-Neo-Agent": "neo-sched",
            "Cache-Control": "no-store",
          },
        });
      } catch {
        // Fall through to JSON
      }
    }

    return NextResponse.json({
      reply: bookedReply,
      agent: "neo-sched",
      data: agentData,
      sessionId,
    });
  }

  // 5. Build final LLM prompt
  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "system", content: `Live team data:\n${liveContext}` },
  ];

  if (orgRosterContext) {
    messages.push({ role: "system", content: `Org roster:\n${orgRosterContext}` });
  }

  // Add conversation history (recalled memory + recent turns)
  messages.push(...conversationHistory);

  // If a sub-agent returned data, inject it
  if (agentData) {
    let agentContext = `${agentUsed} returned this data (summarize naturally, don't dump raw JSON):\n${JSON.stringify(agentData, null, 2)}`;

    if (agentData?.degraded && orgRosterContext) {
      agentContext += "\n\nIMPORTANT: Live DB metrics are degraded. Still answer with org roster details you do have.";
    }

    if (negotiationInfo.started && negotiationInfo.negotiation) {
      const neg = negotiationInfo.negotiation;
      agentContext += `\n\nIMPORTANT: A meeting proposal email has been sent to ${neg.participantName} (${neg.participantEmail}) for the slot above. Mention this to the user — they should know the participant will be emailed.`;
    }

    messages.push({ role: "system", content: agentContext });
  }

  // Add current user message
  messages.push({ role: "user", content: message });

  // 6. Generate response via Lava
  let reply = "";
  try {
    reply = await lavaChat(
      decision.agent && decision.action === "delegate" ? decision.agent : "neo-chat",
      messages,
      { temperature: 0.35, max_tokens: 500 }
    );
    reply = toSpokenStyle(reply);
  } catch {
    reply = agentData
      ? `Here's what I found: ${JSON.stringify(agentData).slice(0, 200)}`
      : "I couldn't process that right now. Try again.";
  }

  // 7. Save assistant turn (non-blocking)
  void saveTurn(sessionId, userId, "assistant", reply, agentUsed).catch(() => {});

  // 8. Return audio or JSON
  if (wantsAudio && reply.length > 0) {
    try {
      const audioStream = await withTimeout(streamSpeech(reply), 15000);
      return new Response(audioStream, {
        headers: {
          "Content-Type": "audio/mpeg",
          "X-Neo-Reply": encodeURIComponent(reply),
          "X-Neo-Agent": agentUsed,
          "Cache-Control": "no-store",
        },
      });
    } catch {
      // Fall through to JSON
    }
  }

  return NextResponse.json({
    reply,
    agent: agentUsed,
    data: agentData,
    negotiation: negotiationInfo.started
      ? {
          negotiationId: negotiationInfo.negotiation?.negotiationId,
          state: negotiationInfo.negotiation?.state,
          participantEmail: negotiationInfo.negotiation?.participantEmail,
        }
      : undefined,
    sessionId,
  });
}

// ── GET /api/agents/chat?sessionId=xxx ───────────────────────────────

export async function GET(req: NextRequest) {
  const sessionId = new URL(req.url).searchParams.get("sessionId");
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }

  try {
    const db = await getDb();
    const doc = await db.collection(COLLECTIONS.conversations).findOne({ sessionId });
    if (!doc) return NextResponse.json({ turns: [] });

    const turns = (doc.turns ?? []).map((t: any) => ({
      role: t.role,
      content: t.content,
      agentUsed: t.agentUsed,
      timestamp: t.timestamp,
    }));

    return NextResponse.json({ turns, sessionId });
  } catch {
    return NextResponse.json({ turns: [] });
  }
}
