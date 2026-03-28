import { MongoClient } from "mongodb";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const uri = process.env.MONGODB_URI!;
const dbName = process.env.MONGODB_DB ?? "neosis";

const now = new Date();
const hoursAgo = (h: number) => new Date(now.getTime() - h * 60 * 60 * 1000);
const today = (hour: number) => {
  const d = new Date(now);
  d.setHours(hour, 0, 0, 0);
  return d;
};

async function seed() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);

  // Clear existing data
  await Promise.all([
    db.collection("prs").deleteMany({}),
    db.collection("tickets").deleteMany({}),
    db.collection("messages").deleteMany({}),
    db.collection("calendars").deleteMany({}),
    db.collection("sprints").deleteMany({}),
    db.collection("preferences").deleteMany({}),
    db.collection("agents").deleteMany({}),
    db.collection("briefs").deleteMany({}),
  ]);

  // ── 10 PRs ──────────────────────────────────────────────────────
  // 4 stale (updatedAt > 24h ago), 2 share same files (conflict demo)
  const prs = [
    {
      prId: "pr-1",
      title: "feat: add Auth0 login flow",
      body: "Implements Auth0 OAuth login for GitHub and Slack integrations",
      author: "sai",
      assignee: "keshav",
      reviewers: ["keshav"],
      approvals: 0,
      requiredApprovals: 1,
      files: ["lib/auth0.ts", "app/api/auth/route.ts", "app/settings/page.tsx"],
      state: "open",
      checks: "pending",
      mergeable: true,
      ticketId: "JIRA-101",
      teamId: "team-1",
      createdAt: hoursAgo(30),
      updatedAt: hoursAgo(26), // STALE
    },
    {
      prId: "pr-2",
      title: "feat: mongodb client singleton",
      body: "Single MongoClient instance, COLLECTIONS constants exported",
      author: "dharma",
      assignee: "veda",
      reviewers: ["veda"],
      approvals: 1,
      requiredApprovals: 1,
      files: ["lib/mongodb.ts"],
      state: "open",
      checks: "success",
      mergeable: true,
      ticketId: "JIRA-102",
      teamId: "team-1",
      createdAt: hoursAgo(5),
      updatedAt: hoursAgo(2),
    },
    {
      prId: "pr-3",
      title: "feat: lava gateway client",
      body: "LLM routing table via Lava, x-lava-agent-id injection",
      author: "dharma",
      assignee: "keshav",
      reviewers: ["keshav"],
      approvals: 0,
      requiredApprovals: 1,
      files: ["lib/lava.ts"],
      state: "open",
      checks: "success",
      mergeable: true,
      ticketId: "JIRA-103",
      teamId: "team-1",
      createdAt: hoursAgo(48),
      updatedAt: hoursAgo(36), // STALE
    },
    {
      prId: "pr-4",
      title: "feat: ElevenLabs streaming TTS",
      body: "eleven_turbo_v2 streaming, first word in 300ms",
      author: "keshav",
      assignee: "dharma",
      reviewers: ["dharma"],
      approvals: 0,
      requiredApprovals: 1,
      files: ["lib/elevenlabs.ts"],
      state: "open",
      checks: "pending",
      mergeable: true,
      ticketId: "JIRA-104",
      teamId: "team-1",
      createdAt: hoursAgo(36),
      updatedAt: hoursAgo(28), // STALE
    },
    {
      prId: "pr-5",
      title: "feat: morning brief agent",
      body: "Reads PRs, tickets, messages and calendar from Mongo, generates spoken brief via Claude Haiku",
      author: "keshav",
      assignee: "veda",
      reviewers: ["veda"],
      approvals: 1,
      requiredApprovals: 1,
      files: ["app/api/agents/brief/route.ts"],
      state: "open",
      checks: "success",
      mergeable: true,
      ticketId: "JIRA-105",
      teamId: "team-1",
      createdAt: hoursAgo(10),
      updatedAt: hoursAgo(4),
    },
    {
      prId: "pr-6",
      title: "feat: voyage AI embeddings",
      body: "embed() and embedBatch() using voyage-code-2",
      author: "veda",
      assignee: "dharma",
      reviewers: ["dharma"],
      approvals: 0,
      requiredApprovals: 1,
      // shares files with pr-7 — CONFLICT DEMO
      files: ["lib/voyage.ts", "app/api/agents/rootcause/route.ts"],
      state: "open",
      checks: "success",
      mergeable: true,
      ticketId: "JIRA-106",
      teamId: "team-1",
      createdAt: hoursAgo(8),
      updatedAt: hoursAgo(1),
    },
    {
      prId: "pr-7",
      title: "fix: voyage embedding dimensions mismatch",
      body: "Fixes 1536 vs 1024 dimension mismatch in Atlas vector index",
      author: "keshav",
      assignee: "veda",
      reviewers: ["veda"],
      approvals: 0,
      requiredApprovals: 1,
      // shares files with pr-6 — CONFLICT DEMO
      files: ["lib/voyage.ts", "app/api/agents/rootcause/route.ts"],
      state: "open",
      checks: "failure",
      mergeable: false,
      ticketId: "JIRA-107",
      teamId: "team-1",
      createdAt: hoursAgo(4),
      updatedAt: hoursAgo(1),
    },
    {
      prId: "pr-8",
      title: "feat: root cause agent with vector search",
      body: "Atlas Vector Search across messages, tickets, prs with 0.7 confidence threshold",
      author: "veda",
      assignee: "sai",
      reviewers: ["sai"],
      approvals: 0,
      requiredApprovals: 1,
      files: ["app/api/agents/rootcause/route.ts"],
      state: "open",
      checks: "pending",
      mergeable: true,
      ticketId: "JIRA-108",
      teamId: "team-1",
      createdAt: hoursAgo(72),
      updatedAt: hoursAgo(48), // STALE
    },
    {
      prId: "pr-9",
      title: "feat: sprint forecast agent",
      body: "Reads velocity + blockers, Claude Sonnet forecasts risk, ElevenLabs speaks it",
      author: "keshav",
      assignee: "dharma",
      reviewers: ["dharma"],
      approvals: 1,
      requiredApprovals: 1,
      files: ["app/api/agents/sprint/route.ts", "app/api/data/sprint/route.ts"],
      state: "open",
      checks: "success",
      mergeable: true,
      ticketId: "JIRA-109",
      teamId: "team-1",
      createdAt: hoursAgo(6),
      updatedAt: hoursAgo(2),
    },
    {
      prId: "pr-10",
      title: "feat: scheduling agent with Nylas",
      body: "Negotiates meeting slots across calendars, confirmation gate before booking",
      author: "sai",
      assignee: "keshav",
      reviewers: ["keshav"],
      approvals: 0,
      requiredApprovals: 1,
      files: ["app/api/agents/schedule/route.ts", "app/api/webhooks/nylas/route.ts"],
      state: "open",
      checks: "success",
      mergeable: true,
      ticketId: "JIRA-110",
      teamId: "team-1",
      createdAt: hoursAgo(3),
      updatedAt: hoursAgo(1),
    },
  ];
  await db.collection("prs").insertMany(prs);
  console.log("✓ PRs seeded (10)");

  // ── 6 Tickets ────────────────────────────────────────────────────
  // 1 P1, 2 P2, 3 blocked by PR ids
  const tickets = [
    {
      ticketId: "JIRA-101",
      title: "Auth0 login integration is broken in staging",
      description: "Users cannot log in via GitHub OAuth. Redirect loop after callback.",
      status: "In Progress",
      priority: 1, // P1
      assignee: "sai",
      reporter: "dharma",
      sprintId: "sprint-1",
      teamId: "team-1",
      blockedBy: ["pr-1"],
      createdAt: hoursAgo(30),
      updatedAt: hoursAgo(26),
    },
    {
      ticketId: "JIRA-106",
      title: "Embedding dimension mismatch crashes root cause agent",
      description: "Voyage AI returns 1024-dim vectors but Atlas index expects 1536. Agent throws on every query.",
      status: "Open",
      priority: 2, // P2
      assignee: "veda",
      reporter: "keshav",
      sprintId: "sprint-1",
      teamId: "team-1",
      blockedBy: ["pr-6", "pr-7"],
      createdAt: hoursAgo(8),
      updatedAt: hoursAgo(4),
    },
    {
      ticketId: "JIRA-108",
      title: "Root cause agent returns empty evidence on all queries",
      description: "Vector search returns no results. Likely Atlas index not created yet.",
      status: "Blocked",
      priority: 2, // P2
      assignee: "veda",
      reporter: "sai",
      sprintId: "sprint-1",
      teamId: "team-1",
      blockedBy: ["pr-8"],
      createdAt: hoursAgo(50),
      updatedAt: hoursAgo(48),
    },
    {
      ticketId: "JIRA-102",
      title: "Set up MongoDB client with connection pooling",
      description: "Single MongoClient singleton, all collection names as constants.",
      status: "Review",
      priority: 3,
      assignee: "dharma",
      reporter: "dharma",
      sprintId: "sprint-1",
      teamId: "team-1",
      blockedBy: [],
      createdAt: hoursAgo(10),
      updatedAt: hoursAgo(2),
    },
    {
      ticketId: "JIRA-104",
      title: "ElevenLabs TTS streaming cuts off on long briefs",
      description: "Audio stream ends before the full script plays. Happens on briefs > 120 words.",
      status: "Open",
      priority: 3,
      assignee: "keshav",
      reporter: "sai",
      sprintId: "sprint-1",
      teamId: "team-1",
      blockedBy: ["pr-4"],
      createdAt: hoursAgo(36),
      updatedAt: hoursAgo(10),
    },
    {
      ticketId: "JIRA-109",
      title: "Sprint forecast should speak on Monday morning automatically",
      description: "Inngest cron job should trigger at 8am Monday per team timezone.",
      status: "Todo",
      priority: 4,
      assignee: "keshav",
      reporter: "dharma",
      sprintId: "sprint-1",
      teamId: "team-1",
      blockedBy: [],
      createdAt: hoursAgo(6),
      updatedAt: hoursAgo(6),
    },
  ];
  await db.collection("tickets").insertMany(tickets);
  console.log("✓ Tickets seeded (6)");

  // ── 20 Slack Messages ────────────────────────────────────────────
  // 3 help threads, messages mentioning PR names
  const messages = [
    // Thread 1: someone asking for review help on pr-3
    {
      messageId: "msg-1",
      channelId: "C-eng-general",
      author: "dharma",
      text: "hey can someone review pr-3? lava gateway client, been sitting for 36 hours",
      mentions: [],
      threadId: "thread-1",
      teamId: "team-1",
      createdAt: hoursAgo(36),
    },
    {
      messageId: "msg-2",
      channelId: "C-eng-general",
      author: "keshav",
      text: "I'll take a look at pr-3 this afternoon after my meetings",
      mentions: ["dharma"],
      threadId: "thread-1",
      teamId: "team-1",
      createdAt: hoursAgo(34),
    },
    {
      messageId: "msg-3",
      channelId: "C-eng-general",
      author: "dharma",
      text: "keshav still waiting on pr-3 review, needed for Veda to start her work",
      mentions: ["keshav"],
      threadId: "thread-1",
      teamId: "team-1",
      createdAt: hoursAgo(12),
    },
    // Thread 2: auth0 issue help
    {
      messageId: "msg-4",
      channelId: "C-eng-general",
      author: "sai",
      text: "auth0 callback is looping — anyone seen this with the nextjs SDK? pr-1 is blocked",
      mentions: [],
      threadId: "thread-2",
      teamId: "team-1",
      createdAt: hoursAgo(28),
    },
    {
      messageId: "msg-5",
      channelId: "C-eng-general",
      author: "dharma",
      text: "sai check AUTH0_BASE_URL in your env — it needs to match the callback URL exactly",
      mentions: ["sai"],
      threadId: "thread-2",
      teamId: "team-1",
      createdAt: hoursAgo(27),
    },
    {
      messageId: "msg-6",
      channelId: "C-eng-general",
      author: "sai",
      text: "still broken even after fixing env. pr-1 needs a design review from mark too",
      mentions: ["dharma"],
      threadId: "thread-2",
      teamId: "team-1",
      createdAt: hoursAgo(20),
    },
    // Thread 3: voyage embedding help
    {
      messageId: "msg-7",
      channelId: "C-eng-ai",
      author: "veda",
      text: "voyage-code-2 is returning 1024 dim vectors but atlas says my index is 1536 — anyone know how to fix this?",
      mentions: [],
      threadId: "thread-3",
      teamId: "team-1",
      createdAt: hoursAgo(8),
    },
    {
      messageId: "msg-8",
      channelId: "C-eng-ai",
      author: "keshav",
      text: "veda try voyage-large-2 instead — that one is 1536. or recreate the atlas index at 1024",
      mentions: ["veda"],
      threadId: "thread-3",
      teamId: "team-1",
      createdAt: hoursAgo(7),
    },
    {
      messageId: "msg-9",
      channelId: "C-eng-ai",
      author: "veda",
      text: "keshav I opened pr-7 as a fix but it conflicts with pr-6 — can you help resolve?",
      mentions: ["keshav"],
      threadId: "thread-3",
      teamId: "team-1",
      createdAt: hoursAgo(4),
    },
    // Standup messages
    {
      messageId: "msg-10",
      channelId: "C-standup",
      author: "dharma",
      text: "yesterday: seeded MongoDB, wrote lib/mongodb.ts. today: finishing lib/lava.ts and Agent 2 PR scanner. blocked: nothing",
      mentions: [],
      threadId: null,
      teamId: "team-1",
      createdAt: hoursAgo(22),
    },
    {
      messageId: "msg-11",
      channelId: "C-standup",
      author: "keshav",
      text: "yesterday: lib/elevenlabs.ts done. today: brief agent route. blocked: waiting on dharma's lava client",
      mentions: ["dharma"],
      threadId: null,
      teamId: "team-1",
      createdAt: hoursAgo(22),
    },
    {
      messageId: "msg-12",
      channelId: "C-standup",
      author: "veda",
      text: "yesterday: atlas vector index setup. today: rootcause agent. blocked: dimension mismatch in voyage embeddings",
      mentions: [],
      threadId: null,
      teamId: "team-1",
      createdAt: hoursAgo(22),
    },
    {
      messageId: "msg-13",
      channelId: "C-standup",
      author: "sai",
      text: "yesterday: auth0 setup + settings page. today: schedule agent + nylas. blocked: pr-1 needs review from mark",
      mentions: [],
      threadId: null,
      teamId: "team-1",
      createdAt: hoursAgo(22),
    },
    // General chatter mentioning PRs
    {
      messageId: "msg-14",
      channelId: "C-eng-general",
      author: "keshav",
      text: "pr-5 is ready for review — morning brief agent works end to end, audio streams cleanly",
      mentions: [],
      threadId: null,
      teamId: "team-1",
      createdAt: hoursAgo(4),
    },
    {
      messageId: "msg-15",
      channelId: "C-eng-general",
      author: "dharma",
      text: "pr-2 approved, merging now. mongodb client is ready for everyone to import",
      mentions: [],
      threadId: null,
      teamId: "team-1",
      createdAt: hoursAgo(2),
    },
    {
      messageId: "msg-16",
      channelId: "C-eng-general",
      author: "veda",
      text: "pr-8 root cause agent is mostly done — needs vector search index before it can be tested",
      mentions: [],
      threadId: null,
      teamId: "team-1",
      createdAt: hoursAgo(48),
    },
    {
      messageId: "msg-17",
      channelId: "C-eng-general",
      author: "sai",
      text: "dashboard UI is up at localhost:3000 — talk to neo button works, agent cards show status",
      mentions: [],
      threadId: null,
      teamId: "team-1",
      createdAt: hoursAgo(1),
    },
    {
      messageId: "msg-18",
      channelId: "C-eng-ai",
      author: "dharma",
      text: "lava dashboard shows neo-pr agent spent $0.0023 on the last scan — exactly what we need for unit economics demo",
      mentions: [],
      threadId: null,
      teamId: "team-1",
      createdAt: hoursAgo(3),
    },
    {
      messageId: "msg-19",
      channelId: "C-eng-general",
      author: "keshav",
      text: "sprint forecast ran this morning — 18 of 24 points at risk, bottleneck is pr-3 and pr-1 unreviewed",
      mentions: [],
      threadId: null,
      teamId: "team-1",
      createdAt: hoursAgo(14),
    },
    {
      messageId: "msg-20",
      channelId: "C-eng-general",
      author: "veda",
      text: "root cause on pr-8: blocked because atlas vector index was never created. fix: create it manually in atlas UI",
      mentions: [],
      threadId: null,
      teamId: "team-1",
      createdAt: hoursAgo(46),
    },
  ];
  await db.collection("messages").insertMany(messages);
  console.log("✓ Slack messages seeded (20)");

  // ── 2 User Calendars ─────────────────────────────────────────────
  // User A busy 3pm, User B busy 4pm, both free 5pm
  const calendars = [
    {
      eventId: "evt-1",
      userId: "user-1",
      title: "1:1 with manager",
      start: today(15), // 3pm — BUSY
      end: today(16),
      attendees: ["user-1", "manager"],
      location: "Zoom",
      description: "Weekly 1:1",
      teamId: "team-1",
      createdAt: hoursAgo(48),
    },
    {
      eventId: "evt-2",
      userId: "user-1",
      title: "Team sync",
      start: today(10),
      end: today(11),
      attendees: ["user-1", "user-2", "user-3", "user-4"],
      location: "Zoom",
      description: "Weekly team sync",
      teamId: "team-1",
      createdAt: hoursAgo(48),
    },
    {
      eventId: "evt-3",
      userId: "user-2",
      title: "Design review",
      start: today(16), // 4pm — BUSY
      end: today(17),
      attendees: ["user-2", "user-3"],
      location: "Google Meet",
      description: "Review dashboard designs",
      teamId: "team-1",
      createdAt: hoursAgo(24),
    },
    // Both users are free at 5pm — scheduling demo slot
  ];
  await db.collection("calendars").insertMany(calendars);
  console.log("✓ Calendars seeded (4 events — user-1 busy 3pm, user-2 busy 4pm, both free 5pm)");

  // ── 1 Sprint ─────────────────────────────────────────────────────
  // 24 story points, 8 complete, 4 blocked
  const sprint = {
    sprintId: "sprint-1",
    teamId: "team-1",
    name: "Sprint 1 — YHack26",
    startDate: hoursAgo(72),
    endDate: new Date(now.getTime() + 48 * 60 * 60 * 1000),
    stories: [
      { id: "s-1", title: "MongoDB client", points: 2, status: "done", prId: "pr-2" },
      { id: "s-2", title: "Lava gateway", points: 2, status: "done", prId: "pr-3" },
      { id: "s-3", title: "Seed script", points: 1, status: "done", prId: null },
      { id: "s-4", title: "ElevenLabs client", points: 2, status: "done", prId: "pr-4" },
      { id: "s-5", title: "Agent 1 brief", points: 3, status: "in-progress", prId: "pr-5" },
      { id: "s-6", title: "Agent 2 PR blocker", points: 3, status: "in-progress", prId: null },
      { id: "s-7", title: "Agent 3 scheduling", points: 3, status: "blocked", prId: "pr-10" },
      { id: "s-8", title: "Agent 4 root cause", points: 4, status: "blocked", prId: "pr-8" },
      { id: "s-9", title: "Agent 5 sprint", points: 3, status: "blocked", prId: "pr-9" },
      { id: "s-10", title: "Dashboard UI", points: 3, status: "blocked", prId: null },
      { id: "s-11", title: "Auth0 integration", points: 2, status: "in-progress", prId: "pr-1" },
    ],
    velocity: 8, // points completed so far
    forecast: null, // filled by sprint agent
    createdAt: hoursAgo(72),
  };
  await db.collection("sprints").insertOne(sprint);
  console.log("✓ Sprint seeded (24pts total, 8 done, 4 blocked)");

  // ── 2 Preference Docs ────────────────────────────────────────────
  const preferences = [
    {
      userId: "user-1",
      name: "Dharma",
      team: "team-1",
      timezone: "America/New_York",
      noMeetingsBefore: 9, // blocks before 9am
      noMeetingsAfter: 18,
      deepWorkDays: [],
      slackUserId: "U001",
      githubUsername: "dharma",
      createdAt: hoursAgo(100),
    },
    {
      userId: "user-2",
      name: "Keshav",
      team: "team-1",
      timezone: "America/New_York",
      noMeetingsBefore: 8,
      noMeetingsAfter: 18,
      deepWorkDays: ["Thursday"], // blocks Thursdays
      slackUserId: "U002",
      githubUsername: "keshav",
      createdAt: hoursAgo(100),
    },
  ];
  await db.collection("preferences").insertMany(preferences);
  console.log("✓ Preferences seeded (2 users)");

  await client.close();
  console.log("\n✅ Seed complete. Run npm run dev to start.");
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
