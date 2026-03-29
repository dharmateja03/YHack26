/**
 * seed-dummy.ts
 *
 * Seeds the local SQLite database with the real YHack26 demo team.
 * User IDs, emails, and org are sourced from DUMMY.md.
 *
 * Run: npm run seed:dummy
 */

import { resolve, dirname } from "path";
import { mkdirSync } from "fs";
import { scryptSync, randomUUID } from "crypto";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config();

// ── SQLite bootstrap ───────────────────────────────────────────────────────────

const DB_PATH = resolve(process.cwd(), process.env.SQLITE_DB_PATH?.trim() || ".data/neosis.sqlite");
mkdirSync(dirname(DB_PATH), { recursive: true });

// Use node:sqlite (built-in, Node >= 22) or fall back to better-sqlite3
let db: any;
try {
  const sqliteMod = await import("node:sqlite" as string);
  const DatabaseSync = (sqliteMod as any).DatabaseSync;
  db = new DatabaseSync(DB_PATH);
} catch {
  const mod = await import("better-sqlite3");
  const BetterSqlite = (mod as any).default ?? mod;
  db = new BetterSqlite(DB_PATH);
}

function exec(sql: string) { return db.exec(sql); }

exec(`
  CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS organizations (
    org_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS org_members (
    user_id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    name TEXT,
    email TEXT,
    work_email TEXT,
    role TEXT NOT NULL,
    joined_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS org_invites (
    token TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    created_by TEXT NOT NULL,
    role TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    max_uses INTEGER NOT NULL,
    uses INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS prs (
    pr_id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    state TEXT NOT NULL,
    author TEXT,
    assignee TEXT,
    reviewers_json TEXT,
    approvals INTEGER,
    required_approvals INTEGER,
    checks TEXT,
    mergeable INTEGER,
    ticket_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    embedding_json TEXT
  );
  CREATE TABLE IF NOT EXISTS tickets (
    ticket_id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL,
    priority INTEGER NOT NULL,
    assignee TEXT,
    reporter TEXT,
    sprint_id TEXT,
    blocked_by_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    embedding_json TEXT
  );
  CREATE TABLE IF NOT EXISTS messages (
    message_id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL,
    channel_id TEXT,
    author TEXT,
    text TEXT NOT NULL,
    mentions_json TEXT,
    thread_id TEXT,
    created_at TEXT NOT NULL,
    embedding_json TEXT
  );
  CREATE TABLE IF NOT EXISTS docs (
    collection TEXT NOT NULL,
    doc_id TEXT NOT NULL,
    doc_json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (collection, doc_id)
  );
  CREATE INDEX IF NOT EXISTS idx_org_members_org_id ON org_members(org_id);
  CREATE INDEX IF NOT EXISTS idx_docs_collection ON docs(collection);
`);

// ── Helpers ────────────────────────────────────────────────────────────────────

function hashPassword(password: string): { hash: string; salt: string } {
  const salt = randomUUID().replace(/-/g, "");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return { hash, salt };
}

function upsertDoc(collection: string, docId: string, doc: object) {
  db.prepare(`
    INSERT INTO docs (collection, doc_id, doc_json, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(collection, doc_id) DO UPDATE SET
      doc_json = excluded.doc_json,
      updated_at = excluded.updated_at
  `).run(collection, docId, JSON.stringify(doc), new Date().toISOString());
}

function daysAgo(n: number)    { return new Date(Date.now() - n * 86400000).toISOString(); }
function hoursAgo(n: number)   { return new Date(Date.now() - n * 3600000).toISOString(); }
function daysFromNow(n: number){ return new Date(Date.now() + n * 86400000).toISOString(); }

// ── 1. Org & Real Members (from DUMMY.md) ──────────────────────────────────────

const ORG_ID   = "org_yhack26";
const ORG_SLUG = "yhack26";
const ORG_NAME = "YHack26";

// Real user accounts — userId = login key, email = password for local demo
const MEMBERS = [
  { userId: "ds3519", name: "Dharma",  email: "ds3519@rit.edu",          role: "manager" as const },
  { userId: "ks2992", name: "Keshav",  email: "ks2992@rit.edu",          role: "member"  as const },
  { userId: "veda",   name: "Veda",    email: "vedakesarwani@gmail.com",  role: "member"  as const },
  { userId: "sai",    name: "Sai",     email: "sairaparla@gmail.com",     role: "member"  as const },
];

// Upsert org
db.prepare(`
  INSERT OR REPLACE INTO organizations (org_id, name, slug, created_by, created_at)
  VALUES (?, ?, ?, ?, ?)
`).run(ORG_ID, ORG_NAME, ORG_SLUG, "ds3519", daysAgo(60));

for (const m of MEMBERS) {
  // Password = email (per DUMMY.md)
  const { hash, salt } = hashPassword(m.email);

  db.prepare(`
    INSERT OR REPLACE INTO users (user_id, name, email, password_hash, password_salt, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(m.userId, m.name, m.email, hash, salt, daysAgo(60));

  db.prepare(`
    INSERT OR REPLACE INTO org_members (user_id, org_id, name, email, work_email, role, joined_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(m.userId, ORG_ID, m.name, m.email, m.email, m.role, daysAgo(55));

  // Extended profile in docs collection (used by team-graph, org context)
  upsertDoc("org_members", m.userId, {
    orgId: ORG_ID,
    userId: m.userId,
    name: m.name,
    email: m.email,
    workEmail: m.email,
    role: m.role,
    joinedAt: daysAgo(55),
    skills:
      m.userId === "ds3519" ? ["leadership", "backend", "system design", "ai"] :
      m.userId === "ks2992" ? ["frontend", "react", "typescript", "testing"] :
      m.userId === "veda"   ? ["backend", "python", "api", "data", "ml"] :
                              ["devops", "k8s", "docker", "ci", "infrastructure"],
    timezone: "America/New_York",
    availability: { days: [1, 2, 3, 4, 5], startHour: 9, endHour: 18 },
  });
}

console.log("✓ Org + members seeded (org_yhack26)");

// ── 2. 20 Pull Requests ────────────────────────────────────────────────────────

const PR_DEFS = [
  // Stale — no reviews, >48h old
  { id: "pr-001", title: "feat: Add vector search to memory recall",        author: "ks2992", approvals: 0, required: 2, updatedAt: daysAgo(5) },
  { id: "pr-002", title: "fix: Race condition in schedule agent booking",   author: "sai",    approvals: 0, required: 2, updatedAt: daysAgo(4) },
  { id: "pr-003", title: "feat: ElevenLabs ConvAI signed URL endpoint",     author: "ds3519", approvals: 0, required: 2, updatedAt: daysAgo(3) },
  { id: "pr-004", title: "refactor: Unify DB adapter across agents",        author: "veda",   approvals: 1, required: 2, updatedAt: daysAgo(3) },
  { id: "pr-005", title: "fix: Hermes gatheringFor state reset on re-ask",  author: "ks2992", approvals: 0, required: 2, updatedAt: daysAgo(7) },
  // Partially reviewed
  { id: "pr-006", title: "feat: Team graph memory — skill matching",        author: "ds3519", approvals: 1, required: 2, updatedAt: daysAgo(2) },
  { id: "pr-007", title: "feat: Manager dashboard — org health API",        author: "sai",    approvals: 1, required: 2, updatedAt: daysAgo(2) },
  { id: "pr-008", title: "fix: Nylas webhook signature validation",         author: "veda",   approvals: 1, required: 1, updatedAt: daysAgo(1) },
  // Fully approved + mergeable
  { id: "pr-009", title: "feat: Brief delta mode — only changed items",     author: "ks2992", approvals: 2, required: 2, updatedAt: hoursAgo(6) },
  { id: "pr-010", title: "fix: ASR normalization for voice parity",         author: "sai",    approvals: 2, required: 2, updatedAt: hoursAgo(4) },
  { id: "pr-011", title: "feat: One-click onboarding wizard",               author: "ds3519", approvals: 2, required: 2, updatedAt: hoursAgo(3) },
  { id: "pr-012", title: "chore: Update ElevenLabs SDK to 1.0",            author: "veda",   approvals: 2, required: 2, updatedAt: hoursAgo(2) },
  // CI failing
  { id: "pr-013", title: "feat: Voyage AI embedding cache layer",           author: "ks2992", approvals: 1, required: 2, updatedAt: hoursAgo(10), checks: "failing" },
  { id: "pr-014", title: "refactor: Extract Slack delivery helper",         author: "sai",    approvals: 0, required: 2, updatedAt: daysAgo(6),  checks: "failing" },
  // In progress
  { id: "pr-015", title: "feat: Priority-first brief ordering",             author: "veda",   approvals: 0, required: 2, updatedAt: daysAgo(2) },
  { id: "pr-016", title: "fix: Sprint forecast velocity calculation",       author: "ds3519", approvals: 1, required: 2, updatedAt: daysAgo(1) },
  { id: "pr-017", title: "feat: Email delivery for brief summaries",        author: "ks2992", approvals: 0, required: 2, updatedAt: daysAgo(8) },
  { id: "pr-018", title: "feat: Auto-reschedule on negotiation reject",     author: "sai",    approvals: 1, required: 2, updatedAt: daysAgo(2) },
  { id: "pr-019", title: "chore: Migrate seed scripts to TypeScript",       author: "veda",   approvals: 2, required: 2, updatedAt: hoursAgo(1) },
  { id: "pr-020", title: "docs: Update ARCHITECTURE.md with team graph",    author: "ds3519", approvals: 2, required: 2, updatedAt: hoursAgo(1) },
];

for (const pr of PR_DEFS) {
  db.prepare(`
    INSERT OR REPLACE INTO prs
    (pr_id, team_id, title, body, state, author, assignee, reviewers_json,
     approvals, required_approvals, checks, mergeable, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    pr.id, ORG_SLUG, pr.title, `Description for: ${pr.title}`, "open",
    pr.author, pr.author, "[]",
    pr.approvals, pr.required, pr.checks ?? "passing",
    pr.approvals >= pr.required ? 1 : 0,
    daysAgo(10), pr.updatedAt,
  );
}

console.log("✓ 20 PRs seeded");

// ── 3. 15 Tickets ──────────────────────────────────────────────────────────────

const SPRINT_ID = "sprint-q1-2026";

const TICKET_DEFS = [
  { id: "tk-001", title: "Fix prod OOM on brief generation",            priority: 0, status: "in_progress", assignee: "ds3519", blockedBy: ["tk-009"] },
  { id: "tk-002", title: "ElevenLabs ConvAI crashes on reconnect",      priority: 0, status: "in_progress", assignee: "ks2992", blockedBy: ["tk-013"] },
  { id: "tk-003", title: "Implement Hermes multi-agent delegation",     priority: 1, status: "in_progress", assignee: "ds3519", blockedBy: [] },
  { id: "tk-004", title: "Team graph: getMemberAvailability",           priority: 1, status: "in_progress", assignee: "veda",   blockedBy: [] },
  { id: "tk-005", title: "Manager dashboard PR risk endpoint",          priority: 1, status: "in_progress", assignee: "sai",    blockedBy: [] },
  { id: "tk-006", title: "Negotiation loop MAX_ROUNDS guard",           priority: 1, status: "review",      assignee: "ks2992", blockedBy: [] },
  { id: "tk-007", title: "ASR normalization for Neo wake word",         priority: 1, status: "review",      assignee: "ks2992", blockedBy: [] },
  { id: "tk-008", title: "Add Jira live API verify to keys route",      priority: 2, status: "todo",        assignee: "sai",    blockedBy: [] },
  { id: "tk-009", title: "MongoDB Atlas slow query investigation",      priority: 2, status: "todo",        assignee: "veda",   blockedBy: [] },
  { id: "tk-010", title: "Onboarding wizard: step 2 org creation",     priority: 2, status: "todo",        assignee: "ds3519", blockedBy: [] },
  { id: "tk-011", title: "Seed script: 20 PRs with realistic data",    priority: 2, status: "done",        assignee: "sai",    blockedBy: [] },
  { id: "tk-012", title: "Sprint velocity tracking fix",               priority: 2, status: "done",        assignee: "veda",   blockedBy: [] },
  { id: "tk-013", title: "Upgrade better-sqlite3 to v12",              priority: 2, status: "todo",        assignee: "ks2992", blockedBy: [] },
  { id: "tk-014", title: "Add Slack brief delivery via bot token",     priority: 2, status: "in_progress", assignee: "sai",    blockedBy: [] },
  { id: "tk-015", title: "DUMMY.md demo scenario documentation",       priority: 2, status: "done",        assignee: "ds3519", blockedBy: [] },
];

for (const t of TICKET_DEFS) {
  db.prepare(`
    INSERT OR REPLACE INTO tickets
    (ticket_id, team_id, title, description, status, priority, assignee, reporter, sprint_id,
     blocked_by_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    t.id, ORG_SLUG, t.title, `Details: ${t.title}`,
    t.status, t.priority, t.assignee, "ds3519",
    SPRINT_ID, JSON.stringify(t.blockedBy),
    daysAgo(14), hoursAgo(Math.floor(Math.random() * 48)),
  );
}

console.log("✓ 15 tickets seeded");

// ── 4. Sprint ──────────────────────────────────────────────────────────────────

const sprintStories = TICKET_DEFS.slice(0, 12).map((t) => ({
  ticketId: t.id, title: t.title, status: t.status, assignee: t.assignee, priority: t.priority,
}));

upsertDoc("sprints", SPRINT_ID, {
  sprintId: SPRINT_ID,
  name: "Q1 2026 – Neo Feature Sprint",
  teamId: ORG_SLUG,
  startDate: daysAgo(14),
  endDate: daysFromNow(7),
  velocity: 42,
  stories: sprintStories,
  status: "active",
  createdAt: daysAgo(14),
});

console.log("✓ Sprint seeded");

// ── 5. 30 Slack messages ───────────────────────────────────────────────────────

const SLACK_MESSAGES = [
  { author: "ks2992", text: "Hey team, PR #pr-001 needs review — vector search is blocking the memory recall feature" },
  { author: "sai",    text: "Reviewed pr-006, left 2 comments. Team graph looks solid @dharma" },
  { author: "veda",   text: "pr-004 is ready for final review, refactored the DB adapter, should reduce latency" },
  { author: "ds3519", text: "Stale PR alert: pr-005 and pr-017 have been open 7+ days without review, please prioritize" },
  { author: "ks2992", text: "CI is failing on pr-013 — the Voyage embedding test is timing out in GitHub Actions" },
  { author: "veda",   text: "Blocked on tk-001 until tk-009 (MongoDB slow queries) is resolved. OOM happens on large collections" },
  { author: "ks2992", text: "tk-002 is blocked waiting for tk-013 (sqlite upgrade). ElevenLabs reconnect crash is in the native module" },
  { author: "ds3519", text: "Let's unblock tk-009 first, it's P2 but it's causing two P0 issues. @veda can you repro it today?" },
  { author: "sai",    text: "Confirmed tk-009 reproduces with >10k docs. Query is missing an index on the state field" },
  { author: "veda",   text: "Added the index, need to test on staging. Should unblock tk-001 by EOD" },
  { author: "ds3519", text: "Need to schedule a sprint review with the whole team before the deadline. @keshav @veda @sai" },
  { author: "ks2992", text: "I'm free Thursday afternoon or Friday morning for sprint review" },
  { author: "veda",   text: "Thursday 3pm works for me" },
  { author: "sai",    text: "Thursday 3pm works, adding to calendar" },
  { author: "ds3519", text: "Neo, schedule sprint review Thursday 3pm with Keshav, Veda, and Sai for 60 minutes" },
  { author: "sai",    text: "Left review on pr-007, the dashboard aggregation logic looks good. One question on sprint risk formula" },
  { author: "ds3519", text: "Good catch @sai — updated the sprint risk to use blockedCount / totalStories ratio" },
  { author: "ks2992", text: "The ASR normalization in page.tsx looks clean. We should also handle 'Hey Neo' as wake word" },
  { author: "veda",   text: "LGTM on pr-008 — Nylas signature fix. Approved" },
  { author: "ks2992", text: "Merging pr-019 now, all checks passing ✓" },
  { author: "sai",    text: "Daily standup notes: completed tk-011, tk-012. Working on tk-008 and tk-014 today" },
  { author: "ds3519", text: "Reminder: sprint ends in 7 days, we have 5 tickets still in todo. Need to triage today" },
  { author: "veda",   text: "Brief from Neo this morning was great — caught the PR stale alert before standup" },
  { author: "ks2992", text: "Voice mode is working well on mobile. The ASR cleanup really helps" },
  { author: "sai",    text: "Dashboard looks great @dharma! The PR risk card with age+approvals score is super useful" },
  { author: "ds3519", text: "Good work everyone. Velocity is at 42 pts this sprint, on track for Q1 goals" },
  { author: "veda",   text: "Finished team graph getMemberAvailability — integrates with calendar collection" },
  { author: "ks2992", text: "Quick question: should the negotiation MAX_ROUNDS be configurable per-org or global?" },
  { author: "ds3519", text: "Global for now, we can make it configurable in a follow-up. 3 rounds is safe" },
  { author: "sai",    text: "seed-dummy.ts is ready for review in pr-019! Covers all 7 entities" },
];

for (let i = 0; i < SLACK_MESSAGES.length; i++) {
  const msg = SLACK_MESSAGES[i];
  const msgId = `slack-msg-${String(i + 1).padStart(3, "0")}`;
  const createdAt = hoursAgo(SLACK_MESSAGES.length - i + Math.floor(Math.random() * 2));
  db.prepare(`
    INSERT OR REPLACE INTO messages
    (message_id, team_id, channel_id, author, text, mentions_json, thread_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(msgId, ORG_SLUG, "C-general", msg.author, msg.text, "[]", msgId, createdAt);
}

console.log("✓ 30 Slack messages seeded");

// ── 6. Calendar events ─────────────────────────────────────────────────────────

const CAL_EVENTS = [
  {
    id: "cal-standup-mon", title: "Daily Standup",
    start: daysFromNow(1).replace(/T.*/, "T09:00:00.000Z"),
    end:   daysFromNow(1).replace(/T.*/, "T09:15:00.000Z"),
    attendees: ["ds3519", "ks2992", "veda", "sai"], emails: ["ds3519@rit.edu", "ks2992@rit.edu", "vedakesarwani@gmail.com", "sairaparla@gmail.com"],
    recurring: true,
  },
  {
    id: "cal-standup-tue", title: "Daily Standup",
    start: daysFromNow(2).replace(/T.*/, "T09:00:00.000Z"),
    end:   daysFromNow(2).replace(/T.*/, "T09:15:00.000Z"),
    attendees: ["ds3519", "ks2992", "veda", "sai"], emails: ["ds3519@rit.edu", "ks2992@rit.edu", "vedakesarwani@gmail.com", "sairaparla@gmail.com"],
    recurring: true,
  },
  {
    id: "cal-standup-wed", title: "Daily Standup",
    start: daysFromNow(3).replace(/T.*/, "T09:00:00.000Z"),
    end:   daysFromNow(3).replace(/T.*/, "T09:15:00.000Z"),
    attendees: ["ds3519", "ks2992", "veda", "sai"], emails: ["ds3519@rit.edu", "ks2992@rit.edu", "vedakesarwani@gmail.com", "sairaparla@gmail.com"],
    recurring: true,
  },
  {
    id: "cal-1on1-keshav", title: "1:1 Dharma × Keshav",
    start: daysFromNow(2).replace(/T.*/, "T10:00:00.000Z"),
    end:   daysFromNow(2).replace(/T.*/, "T10:30:00.000Z"),
    attendees: ["ds3519", "ks2992"], emails: ["ds3519@rit.edu", "ks2992@rit.edu"],
  },
  {
    id: "cal-1on1-sai", title: "1:1 Dharma × Sai",
    start: daysFromNow(4).replace(/T.*/, "T11:00:00.000Z"),
    end:   daysFromNow(4).replace(/T.*/, "T11:30:00.000Z"),
    attendees: ["ds3519", "sai"], emails: ["ds3519@rit.edu", "sairaparla@gmail.com"],
  },
  {
    id: "cal-sprint-review", title: "Sprint Review",
    start: daysFromNow(3).replace(/T.*/, "T15:00:00.000Z"),
    end:   daysFromNow(3).replace(/T.*/, "T16:00:00.000Z"),
    attendees: ["ds3519", "ks2992", "veda", "sai"], emails: ["ds3519@rit.edu", "ks2992@rit.edu", "vedakesarwani@gmail.com", "sairaparla@gmail.com"],
  },
  {
    id: "cal-focus-dharma", title: "Focus Block — No Meetings",
    start: daysFromNow(1).replace(/T.*/, "T14:00:00.000Z"),
    end:   daysFromNow(1).replace(/T.*/, "T17:00:00.000Z"),
    attendees: ["ds3519"], emails: ["ds3519@rit.edu"],
  },
  {
    id: "cal-focus-keshav", title: "Deep Work: PR Reviews",
    start: daysFromNow(2).replace(/T.*/, "T13:00:00.000Z"),
    end:   daysFromNow(2).replace(/T.*/, "T16:00:00.000Z"),
    attendees: ["ks2992"], emails: ["ks2992@rit.edu"],
  },
];

for (const evt of CAL_EVENTS) {
  for (let i = 0; i < evt.attendees.length; i++) {
    const userId = evt.attendees[i];
    const email  = evt.emails[i];
    const docId  = `${evt.id}:${userId}`;
    upsertDoc("calendars", docId, {
      eventId: evt.id,
      userId,
      email,
      title: evt.title,
      start: evt.start,
      end: evt.end,
      attendees: evt.attendees,
      attendeeEmails: evt.emails,
      recurring: (evt as any).recurring ?? false,
      autoReschedule: true,
      teamId: ORG_SLUG,
      createdAt: daysAgo(7),
    });
  }
}

console.log("✓ 8 calendar events seeded (with real emails)");

// ── 7. 2 Active Negotiations ───────────────────────────────────────────────────

upsertDoc("negotiations", "neg-001", {
  negotiationId: "neg-001",
  threadId: "thread-neg-001",
  sessionId: "sess-001",
  requesterUserId: "ds3519",
  requesterEmail: "ds3519@rit.edu",
  participantEmail: "investor@vc.example.com",
  participantName: "Alex (VC)",
  title: "Investor Demo Call",
  priority: 5,
  durationMins: 45,
  state: "counter",
  proposedSlot: { start: daysFromNow(3).replace(/T.*/, "T14:00:00.000Z"), end: daysFromNow(3).replace(/T.*/, "T14:45:00.000Z") },
  counterSlot:  { start: daysFromNow(4).replace(/T.*/, "T10:00:00.000Z"), end: daysFromNow(4).replace(/T.*/, "T10:45:00.000Z") },
  roundCount: 1,
  emailThread: [
    { from: "ds3519@rit.edu",         text: "Hi Alex, I'd like to schedule a 45-min demo call.",          timestamp: daysAgo(2) },
    { from: "investor@vc.example.com", text: "Sounds great! How about Thursday at 2pm?",                  timestamp: daysAgo(1) },
    { from: "neo-agent@neosis.ai",     text: "Hi Alex, Thursday 2pm works — also offering Fri 10am.",     timestamp: hoursAgo(12) },
  ],
  createdAt: daysAgo(2),
  updatedAt: hoursAgo(12),
});

upsertDoc("negotiations", "neg-002", {
  negotiationId: "neg-002",
  threadId: "thread-neg-002",
  sessionId: "sess-002",
  requesterUserId: "ks2992",
  requesterEmail: "ks2992@rit.edu",
  participantEmail: "advisor@mentor.example.com",
  participantName: "Priya (Advisor)",
  title: "Technical Architecture Review",
  priority: 3,
  durationMins: 60,
  state: "proposed",
  proposedSlot: { start: daysFromNow(5).replace(/T.*/, "T11:00:00.000Z"), end: daysFromNow(5).replace(/T.*/, "T12:00:00.000Z") },
  alternatives: [
    { start: daysFromNow(6).replace(/T.*/, "T14:00:00.000Z"), end: daysFromNow(6).replace(/T.*/, "T15:00:00.000Z") },
  ],
  roundCount: 0,
  emailThread: [
    { from: "neo-agent@neosis.ai", text: "Hi Priya, Keshav would like to schedule a 1-hour architecture review.", timestamp: hoursAgo(3) },
  ],
  createdAt: hoursAgo(3),
  updatedAt: hoursAgo(3),
});

console.log("✓ 2 negotiations seeded");

// ── 8. Brief history ───────────────────────────────────────────────────────────

const BRIEF_SCRIPTS = [
  "Morning brief: 3 stale PRs need immediate review — pr-001, pr-005, pr-017. Sprint is 40% complete with 2 P0 blockers. First meeting is standup at 9am.",
  "Evening brief: Good progress today — pr-019 merged, sprint velocity holding at 42. Two P0 tickets still blocked on MongoDB slow query investigation.",
  "Morning brief: P0 alert — tk-001 and tk-002 remain blocked. Veda's index fix should unblock by EOD. 6 PRs need review.",
  "Morning brief: Sprint week 2, 5 tickets in todo. Prioritize tk-008 and tk-014 today. Investor demo call negotiation with Alex is in counter state.",
  "Evening brief: Team velocity on track. PR review queue down to 4. Negotiation with Priya proposed for next week — watch for reply.",
];

for (let i = 0; i < BRIEF_SCRIPTS.length; i++) {
  upsertDoc("briefs", `brief-demo-${i + 1}`, {
    briefId: `brief-demo-${i + 1}`,
    userId: "ds3519",
    type: i % 2 === 0 ? "morning" : "evening",
    script: BRIEF_SCRIPTS[i],
    isManager: true,
    deltaOnly: false,
    snapshot: {
      prIds: PR_DEFS.slice(0, 5 + i).map((p) => p.id),
      ticketStates: Object.fromEntries(TICKET_DEFS.slice(0, 5).map((t) => [t.id, t.status])),
    },
    createdAt: daysAgo(i + 1),
  });
}

console.log("✓ 5 brief history entries seeded");

// ── Done ───────────────────────────────────────────────────────────────────────

console.log(`
╔══════════════════════════════════════════════════════════════╗
║              Neosis Demo Data — YHack26                       ║
╠══════════════════════════════════════════════════════════════╣
║  DB:         ${DB_PATH.split("/").pop()?.padEnd(46)}║
║  Org:        org_yhack26 (YHack26)                            ║
╠══════════════════════════════════════════════════════════════╣
║  ACCOUNTS (email = password)                                  ║
║  Dharma  ds3519@rit.edu          [manager]                    ║
║  Keshav  ks2992@rit.edu          [member]                     ║
║  Veda    vedakesarwani@gmail.com  [member]                    ║
║  Sai     sairaparla@gmail.com     [member]                    ║
╠══════════════════════════════════════════════════════════════╣
║  PRs:         20  (5 stale, 4 approved, 2 CI failing)         ║
║  Tickets:     15  (2 P0 blocked, 5 P1, 8 P2)                 ║
║  Sprint:      Q1 2026  |  42 pts velocity  |  active         ║
║  Slack msgs:  30                                              ║
║  Calendar:    8 events (real emails on invites)               ║
║  Negotiations: 2  (counter + proposed)                        ║
║  Briefs:      5  history entries                              ║
╠══════════════════════════════════════════════════════════════╣
║  Run: npm run dev  →  /dashboard                              ║
╚══════════════════════════════════════════════════════════════╝
`);
