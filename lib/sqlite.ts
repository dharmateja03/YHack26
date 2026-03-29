import { mkdirSync } from "fs";
import { dirname, resolve } from "path";

type SqliteStatement = {
  get: (...args: any[]) => any;
  all: (...args: any[]) => any[];
  run: (...args: any[]) => any;
};

export type SqliteDb = {
  exec: (sql: string) => void;
  prepare: (sql: string) => SqliteStatement;
};

type SqliteGlobal = {
  __sqliteDbPromise?: Promise<SqliteDb | null>;
};

const sqliteGlobal = globalThis as typeof globalThis & SqliteGlobal;

function sqlitePath(): string {
  return resolve(process.cwd(), process.env.SQLITE_DB_PATH?.trim() || ".data/neosis.sqlite");
}

function sqliteEnabled(): boolean {
  const raw = process.env.ENABLE_SQLITE_FALLBACK;
  if (!raw) return true;
  return raw.trim().toLowerCase() !== "false";
}

function initSchema(db: SqliteDb) {
  db.exec(`
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

    CREATE INDEX IF NOT EXISTS idx_org_members_org_id ON org_members(org_id);

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

    CREATE INDEX IF NOT EXISTS idx_org_invites_org_id ON org_invites(org_id);

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

    CREATE INDEX IF NOT EXISTS idx_prs_team_state ON prs(team_id, state);

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

    CREATE INDEX IF NOT EXISTS idx_tickets_team_priority ON tickets(team_id, priority);

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

    CREATE INDEX IF NOT EXISTS idx_messages_team_created_at ON messages(team_id, created_at);
  `);
}

export async function getSqliteDbSafe(): Promise<SqliteDb | null> {
  if (!sqliteEnabled()) return null;
  if (!sqliteGlobal.__sqliteDbPromise) {
    sqliteGlobal.__sqliteDbPromise = (async () => {
      const path = sqlitePath();
      mkdirSync(dirname(path), { recursive: true });

      // Prefer the built-in driver when available (Node >= 22), then fall back
      // to better-sqlite3 for Node versions that do not ship node:sqlite.
      try {
        const sqliteImporter = new Function('return import("node:sqlite")');
        const sqliteMod = await (sqliteImporter() as Promise<any>);
        const DatabaseSync = (sqliteMod as any).DatabaseSync;
        const db = new DatabaseSync(path) as SqliteDb;
        initSchema(db);
        return db;
      } catch {
        try {
          const betterSqliteMod = await import("better-sqlite3");
          const BetterSqlite = (betterSqliteMod as any).default ?? betterSqliteMod;
          const db = new BetterSqlite(path) as SqliteDb;
          initSchema(db);
          return db;
        } catch {
          return null;
        }
      }
    })();
  }
  return sqliteGlobal.__sqliteDbPromise;
}
