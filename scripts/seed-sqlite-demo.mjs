import dotenv from "dotenv";
import { resolve, dirname } from "path";
import { mkdirSync } from "fs";
import { randomUUID, scryptSync } from "crypto";

dotenv.config({ path: ".env.local" });
dotenv.config();

function parseMode() {
  const i = process.argv.findIndex((a) => a === "--mode");
  if (i === -1) return "demo";
  return String(process.argv[i + 1] || "demo").toLowerCase();
}

function resolveSqlitePath() {
  const p1 = process.env.SQLITE_DB_PATH?.trim();
  if (p1) return resolve(process.cwd(), p1);
  const p2 = process.env.SQLITE_PATH?.trim();
  if (p2) return resolve(process.cwd(), p2);
  const durl = process.env.DATABASE_URL?.trim();
  if (durl?.startsWith("file:")) {
    const raw = durl.slice("file:".length);
    if (raw.startsWith("/")) return raw;
    return resolve(process.cwd(), raw);
  }
  return resolve(process.cwd(), ".data/neosis.sqlite");
}

function nowIso(offsetMinutes = 0) {
  return new Date(Date.now() + offsetMinutes * 60_000).toISOString();
}

function hashPassword(password, salt) {
  return scryptSync(password, salt, 64).toString("hex");
}

function upsertDoc(sqlite, collection, id, doc) {
  sqlite
    .prepare(
      `INSERT INTO docs (collection, doc_id, doc_json, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(collection, doc_id) DO UPDATE SET
         doc_json = excluded.doc_json,
         updated_at = excluded.updated_at`
    )
    .run(collection, id, JSON.stringify(doc), new Date().toISOString());
}

function tomorrowAt(hour, minute) {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(hour, minute, 0, 0);
  return d;
}

async function run() {
  const mode = parseMode();
  const sqlitePath = resolveSqlitePath();
  mkdirSync(dirname(sqlitePath), { recursive: true });

  const betterSqliteMod = await import("better-sqlite3");
  const BetterSqlite = betterSqliteMod.default ?? betterSqliteMod;
  const sqlite = new BetterSqlite(sqlitePath);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS docs (
      collection TEXT NOT NULL,
      doc_id TEXT NOT NULL,
      doc_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (collection, doc_id)
    );
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
  `);

  const orgId = "org_yhack26";
  const orgSlug = "yhack26";
  const orgName = "YHack26";
  const teamId = "team-1";
  const members = [
    { userId: "ds3519", name: "Dharma", email: "ds3519@rit.edu", role: "manager", priority: 5 },
    { userId: "ks2992", name: "Keshav", email: "ks2992@rit.edu", role: "member", priority: 4 },
    { userId: "veda", name: "Veda", email: "vedakesarwani@gmail.com", role: "member", priority: 3 },
    { userId: "sai", name: "Sai", email: "sairaparla@gmail.com", role: "member", priority: 3 },
  ];

  const now = new Date().toISOString();
  sqlite
    .prepare(
      `INSERT INTO organizations (org_id, name, slug, created_by, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(org_id) DO UPDATE SET
         name = excluded.name,
         slug = excluded.slug,
         created_by = excluded.created_by`
    )
    .run(orgId, orgName, orgSlug, "ds3519", now);

  for (const m of members) {
    const existing = sqlite
      .prepare("SELECT password_salt FROM users WHERE email = ?")
      .get(m.email);
    const salt = existing?.password_salt || randomUUID().replace(/-/g, "");
    sqlite
      .prepare(
        `INSERT INTO users (user_id, name, email, password_hash, password_salt, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(email) DO UPDATE SET
           user_id = excluded.user_id,
           name = excluded.name,
           password_hash = excluded.password_hash,
           password_salt = excluded.password_salt`
      )
      .run(m.userId, m.name, m.email, hashPassword(m.email, salt), salt, now);

    sqlite
      .prepare(
        `INSERT INTO org_members (user_id, org_id, name, email, work_email, role, joined_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           org_id = excluded.org_id,
           name = excluded.name,
           email = excluded.email,
           work_email = excluded.work_email,
           role = excluded.role`
      )
      .run(m.userId, orgId, m.name, m.email, m.email, m.role, now);
  }

  const dayStart = tomorrowAt(9, 0);
  const soccerStart = tomorrowAt(14, 30);
  const soccerEnd = tomorrowAt(16, 0);
  const artStart = tomorrowAt(17, 0);
  const artEnd = tomorrowAt(18, 0);

  const calendars = [
    {
      eventId: "cal-sai-soccer",
      userId: "sai",
      title: "Soccer",
      start: soccerStart.toISOString(),
      end: soccerEnd.toISOString(),
      attendees: ["sai"],
      attendeeEmails: ["sairaparla@gmail.com"],
      createdAt: now,
      orgId,
    },
    {
      eventId: "cal-veda-art",
      userId: "veda",
      title: "Art Class",
      start: artStart.toISOString(),
      end: artEnd.toISOString(),
      attendees: ["veda"],
      attendeeEmails: ["vedakesarwani@gmail.com"],
      createdAt: now,
      orgId,
    },
    {
      eventId: "cal-dharma-focus",
      userId: "ds3519",
      title: "Manager Focus",
      start: new Date(dayStart.getTime() + 120 * 60_000).toISOString(),
      end: new Date(dayStart.getTime() + 180 * 60_000).toISOString(),
      attendees: ["ds3519"],
      attendeeEmails: ["ds3519@rit.edu"],
      createdAt: now,
      orgId,
    },
  ];

  for (const ev of calendars) {
    upsertDoc(sqlite, "calendars", `${ev.eventId}:${ev.userId}`, ev);
  }

  const scale = mode === "full" || mode === "dummy" ? 12 : 6;
  const prs = Array.from({ length: scale }).map((_, i) => {
    const owner = members[i % members.length];
    const assignee = members[(i + 1) % members.length];
    return {
      prId: `pr-${mode}-${i + 1}`,
      teamId,
      title: `Scheduler improvement ${i + 1}`,
      body: `Improves meeting orchestration path ${i + 1}`,
      author: owner.name,
      assignee: assignee.name,
      reviewers: ["Dharma", "Keshav", "Veda", "Sai"],
      approvals: i % 3,
      requiredApprovals: 1,
      state: "open",
      checks: i % 4 === 0 ? "failing" : "passing",
      mergeable: true,
      ticketId: `T-${i + 1}`,
      createdAt: nowIso(-(800 - i * 8)),
      updatedAt: nowIso(-(200 - i * 6)),
    };
  });

  const tickets = Array.from({ length: scale }).map((_, i) => {
    const owner = members[(i + 2) % members.length];
    return {
      ticketId: `T-${i + 1}`,
      teamId,
      title: `Org scheduler ticket ${i + 1}`,
      description: `Track dependency and unblock schedule task ${i + 1}`,
      status: i % 5 === 0 ? "Blocked" : "In Progress",
      priority: (i % 4) + 1,
      assignee: owner.name,
      reporter: "Dharma",
      sprintId: "sprint-1",
      blockedBy: i % 5 === 0 ? [`T-${Math.max(1, i)}`] : [],
      createdAt: nowIso(-(1000 - i * 10)),
      updatedAt: nowIso(-(300 - i * 5)),
    };
  });

  const messages = Array.from({ length: scale * 2 }).map((_, i) => {
    const owner = members[i % members.length];
    return {
      messageId: `m-${mode}-${i + 1}`,
      teamId,
      channelId: "eng",
      author: owner.userId,
      text:
        i % 4 === 0
          ? "Need a fast P0 sync for launch blockers."
          : "Checking team availability for tomorrow.",
      mentions: ["ds3519", "ks2992", "veda", "sai"],
      threadId: `th-${Math.floor(i / 2) + 1}`,
      createdAt: nowIso(-(160 - i * 3)),
    };
  });

  for (const pr of prs) {
    upsertDoc(sqlite, "prs", pr.prId, pr);
    sqlite
      .prepare(
        `INSERT INTO prs
         (pr_id, team_id, title, body, state, author, assignee, reviewers_json, approvals, required_approvals, checks, mergeable, ticket_id, created_at, updated_at, embedding_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(pr_id) DO UPDATE SET
           team_id = excluded.team_id,
           title = excluded.title,
           body = excluded.body,
           state = excluded.state,
           author = excluded.author,
           assignee = excluded.assignee,
           reviewers_json = excluded.reviewers_json,
           approvals = excluded.approvals,
           required_approvals = excluded.required_approvals,
           checks = excluded.checks,
           mergeable = excluded.mergeable,
           ticket_id = excluded.ticket_id,
           created_at = excluded.created_at,
           updated_at = excluded.updated_at`
      )
      .run(
        pr.prId,
        pr.teamId,
        pr.title,
        pr.body,
        pr.state,
        pr.author,
        pr.assignee,
        JSON.stringify(pr.reviewers),
        pr.approvals,
        pr.requiredApprovals,
        pr.checks,
        pr.mergeable ? 1 : 0,
        pr.ticketId,
        pr.createdAt,
        pr.updatedAt,
        null
      );
  }

  for (const t of tickets) {
    upsertDoc(sqlite, "tickets", t.ticketId, t);
    sqlite
      .prepare(
        `INSERT INTO tickets
         (ticket_id, team_id, title, description, status, priority, assignee, reporter, sprint_id, blocked_by_json, created_at, updated_at, embedding_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(ticket_id) DO UPDATE SET
           team_id = excluded.team_id,
           title = excluded.title,
           description = excluded.description,
           status = excluded.status,
           priority = excluded.priority,
           assignee = excluded.assignee,
           reporter = excluded.reporter,
           sprint_id = excluded.sprint_id,
           blocked_by_json = excluded.blocked_by_json,
           created_at = excluded.created_at,
           updated_at = excluded.updated_at`
      )
      .run(
        t.ticketId,
        t.teamId,
        t.title,
        t.description,
        t.status,
        t.priority,
        t.assignee,
        t.reporter,
        t.sprintId,
        JSON.stringify(t.blockedBy),
        t.createdAt,
        t.updatedAt,
        null
      );
  }

  for (const m of messages) {
    upsertDoc(sqlite, "messages", m.messageId, m);
    sqlite
      .prepare(
        `INSERT INTO messages
         (message_id, team_id, channel_id, author, text, mentions_json, thread_id, created_at, embedding_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(message_id) DO UPDATE SET
           team_id = excluded.team_id,
           channel_id = excluded.channel_id,
           author = excluded.author,
           text = excluded.text,
           mentions_json = excluded.mentions_json,
           thread_id = excluded.thread_id,
           created_at = excluded.created_at`
      )
      .run(
        m.messageId,
        m.teamId,
        m.channelId,
        m.author,
        m.text,
        JSON.stringify(m.mentions),
        m.threadId,
        m.createdAt,
        null
      );
  }

  sqlite.close();
  console.log(`seed-sqlite complete (${mode})`);
  console.log("org members: Dharma(ds3519), Keshav(ks2992), Veda(veda), Sai(sai)");
  console.log("calendar constraints: Sai soccer 2:30-4:00 PM, Veda art class 5:00-6:00 PM (tomorrow)");
  console.log(`prs=${prs.length} tickets=${tickets.length} messages=${messages.length}`);
}

run().catch((err) => {
  console.error("seed-sqlite failed:", err?.message || err);
  process.exit(1);
});
