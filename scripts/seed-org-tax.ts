import { randomUUID, scryptSync } from "crypto";
import * as dotenv from "dotenv";
import { dirname, resolve } from "path";
import { mkdirSync } from "fs";

dotenv.config({ path: ".env.local" });
dotenv.config();

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 64).toString("hex");
}

async function run() {
  const sqlitePath = resolve(process.cwd(), process.env.SQLITE_DB_PATH?.trim() || ".data/neosis.sqlite");
  mkdirSync(dirname(sqlitePath), { recursive: true });

  const managerEmail = normalizeEmail(process.env.SEED_MANAGER_EMAIL || "ds3519@rit.edu");
  const memberEmail = normalizeEmail(process.env.SEED_MEMBER_EMAIL || "ks2992@rit.edu");
  const managerName = process.env.SEED_MANAGER_NAME?.trim() || "Dharma";
  const memberName = process.env.SEED_MEMBER_NAME?.trim() || "Keshav";

  const betterSqliteMod = await import("better-sqlite3");
  const BetterSqlite = (betterSqliteMod as any).default ?? betterSqliteMod;
  const sqlite = new BetterSqlite(sqlitePath);

  sqlite.exec(`
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
  `);

  const now = new Date().toISOString();
  const orgId = "org_tax";

  const getUser = sqlite.prepare("SELECT user_id, password_salt FROM users WHERE email = ?");
  const upsertUser = sqlite.prepare(
    `INSERT INTO users (user_id, name, email, password_hash, password_salt, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET
       name = excluded.name,
       password_hash = excluded.password_hash,
       password_salt = excluded.password_salt`
  );

  const managerExisting = getUser.get(managerEmail) as { user_id?: string; password_salt?: string } | undefined;
  const managerUserId = managerExisting?.user_id || "user_ds3519";
  const managerSalt = managerExisting?.password_salt || randomUUID().replace(/-/g, "");
  upsertUser.run(
    managerUserId,
    managerName,
    managerEmail,
    hashPassword(managerEmail, managerSalt),
    managerSalt,
    now
  );

  const memberExisting = getUser.get(memberEmail) as { user_id?: string; password_salt?: string } | undefined;
  const memberUserId = memberExisting?.user_id || "user_ks2992";
  const memberSalt = memberExisting?.password_salt || randomUUID().replace(/-/g, "");
  upsertUser.run(
    memberUserId,
    memberName,
    memberEmail,
    hashPassword(memberEmail, memberSalt),
    memberSalt,
    now
  );

  sqlite
    .prepare(
      `INSERT INTO organizations (org_id, name, slug, created_by, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(org_id) DO UPDATE SET
         name = excluded.name,
         slug = excluded.slug,
         created_by = excluded.created_by`
    )
    .run(orgId, "tax", "tax", managerUserId, now);

  const upsertMember = sqlite.prepare(
    `INSERT INTO org_members (user_id, org_id, name, email, work_email, role, joined_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       org_id = excluded.org_id,
       name = excluded.name,
       email = excluded.email,
       work_email = excluded.work_email,
       role = excluded.role`
  );

  upsertMember.run(managerUserId, orgId, managerName, managerEmail, managerEmail, "manager", now);
  upsertMember.run(memberUserId, orgId, memberName, memberEmail, memberEmail, "member", now);

  sqlite.close();

  console.log("Seeded org + users (sqlite)");
  console.log(`- org: tax (${orgId})`);
  console.log(`- manager: ${managerEmail} userId=${managerUserId} password=<email>`);
  console.log(`- member: ${memberEmail} userId=${memberUserId} password=<email>`);
}

run().catch((err) => {
  console.error("seed-org-tax failed:", err?.message || err);
  process.exit(1);
});
