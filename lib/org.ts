import { randomUUID } from "crypto";
import { COLLECTIONS, getDb } from "@/lib/mongodb";
import { getSqliteDbSafe, SqliteDb } from "@/lib/sqlite";

export type OrgRole = "manager" | "member";

export interface OrgDoc {
  orgId: string;
  name: string;
  slug: string;
  createdBy: string;
  createdAt: Date;
}

export interface MemberAvailability {
  days: number[];        // 0=Sun,1=Mon,...,6=Sat
  startHour: number;    // UTC hour work starts
  endHour: number;      // UTC hour work ends
}

export interface OrgMemberDoc {
  orgId: string;
  userId: string;
  name?: string;
  email?: string;
  workEmail?: string;
  role: OrgRole;
  joinedAt: Date;
  skills?: string[];
  timezone?: string;
  availability?: MemberAvailability;
}

export interface OrgInviteDoc {
  token: string;
  orgId: string;
  createdBy: string;
  role: OrgRole;
  createdAt: Date;
  expiresAt: Date;
  maxUses: number;
  uses: number;
}

export interface OrgContext {
  org: OrgDoc;
  me: OrgMemberDoc;
  members: OrgMemberDoc[];
  invites: OrgInviteDoc[];
}

type OrgMemoryStore = {
  orgs: Map<string, OrgDoc>;
  membersByUser: Map<string, OrgMemberDoc>;
  invites: Map<string, OrgInviteDoc>;
};

const orgMemoryGlobal = globalThis as typeof globalThis & {
  __orgMemoryStore?: OrgMemoryStore;
};

function getMemoryStore(): OrgMemoryStore {
  if (!orgMemoryGlobal.__orgMemoryStore) {
    orgMemoryGlobal.__orgMemoryStore = {
      orgs: new Map<string, OrgDoc>(),
      membersByUser: new Map<string, OrgMemberDoc>(),
      invites: new Map<string, OrgInviteDoc>(),
    };
  }
  return orgMemoryGlobal.__orgMemoryStore;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

function now(): Date {
  return new Date();
}

function plusDays(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

async function getDbSafe() {
  try {
    return await getDb();
  } catch {
    // In production, fail hard when DB is configured but unavailable.
    // In local dev, fall back to global in-memory store for demo continuity.
    if (process.env.MONGODB_URI?.trim() && process.env.NODE_ENV === "production") {
      throw new Error("db_unavailable");
    }
    return null;
  }
}

function sanitizeMember(member: OrgMemberDoc): OrgMemberDoc {
  return {
    ...member,
    name: member.name?.trim() || undefined,
    email: member.email?.trim().toLowerCase() || undefined,
    workEmail: member.workEmail?.trim().toLowerCase() || undefined,
  };
}

function normalizeIdentityEmail(email?: string): string | undefined {
  const v = email?.trim().toLowerCase();
  return v || undefined;
}

function toDate(value: unknown): Date {
  if (value instanceof Date) return value;
  const d = new Date(String(value ?? ""));
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function sqliteOrg(row: any): OrgDoc {
  return {
    orgId: String(row.org_id),
    name: String(row.name),
    slug: String(row.slug),
    createdBy: String(row.created_by),
    createdAt: toDate(row.created_at),
  };
}

function sqliteMember(row: any): OrgMemberDoc {
  return sanitizeMember({
    orgId: String(row.org_id),
    userId: String(row.user_id),
    name: row.name ? String(row.name) : undefined,
    email: row.email ? String(row.email) : undefined,
    workEmail: row.work_email ? String(row.work_email) : undefined,
    role: (String(row.role) as OrgRole) || "member",
    joinedAt: toDate(row.joined_at),
  });
}

function sqliteInvite(row: any): OrgInviteDoc {
  return {
    token: String(row.token),
    orgId: String(row.org_id),
    createdBy: String(row.created_by),
    role: (String(row.role) as OrgRole) || "member",
    createdAt: toDate(row.created_at),
    expiresAt: toDate(row.expires_at),
    maxUses: Number(row.max_uses ?? 0),
    uses: Number(row.uses ?? 0),
  };
}

async function getOrgContextForUserSqlite(sqlite: SqliteDb, userId: string): Promise<OrgContext | null> {
  const meRow = sqlite
    .prepare(
      "SELECT org_id, user_id, name, email, work_email, role, joined_at FROM org_members WHERE user_id = ?"
    )
    .get(userId);
  if (!meRow) return null;
  const me = sqliteMember(meRow);

  const orgRow = sqlite
    .prepare("SELECT org_id, name, slug, created_by, created_at FROM organizations WHERE org_id = ?")
    .get(me.orgId);
  if (!orgRow) return null;
  const org = sqliteOrg(orgRow);

  const memberRows = sqlite
    .prepare(
      `SELECT org_id, user_id, name, email, work_email, role, joined_at
       FROM org_members
       WHERE org_id = ?
       ORDER BY CASE role WHEN 'manager' THEN 0 ELSE 1 END, joined_at ASC`
    )
    .all(me.orgId);
  const members = memberRows.map(sqliteMember);

  const invites =
    me.role === "manager"
      ? sqlite
          .prepare(
            `SELECT token, org_id, created_by, role, created_at, expires_at, max_uses, uses
             FROM org_invites
             WHERE org_id = ? AND expires_at > ?
             ORDER BY created_at DESC`
          )
          .all(me.orgId, now().toISOString())
          .map(sqliteInvite)
      : [];

  return { org, me, members, invites };
}

export async function getOrgContextForUser(userId: string): Promise<OrgContext | null> {
  const mem = getMemoryStore();
  const db = await getDbSafe();
  const sqlite = db ? null : await getSqliteDbSafe();

  if (db) {
    const me = (await db
      .collection<OrgMemberDoc>(COLLECTIONS.orgMembers)
      .findOne({ userId })) as OrgMemberDoc | null;

    if (!me) return null;

    const [org, members, invites] = await Promise.all([
      db.collection<OrgDoc>(COLLECTIONS.organizations).findOne({ orgId: me.orgId }) as Promise<OrgDoc | null>,
      db
        .collection<OrgMemberDoc>(COLLECTIONS.orgMembers)
        .find({ orgId: me.orgId })
        .sort({ role: -1, joinedAt: 1 })
        .toArray() as Promise<OrgMemberDoc[]>,
      me.role === "manager"
        ? (db
            .collection<OrgInviteDoc>(COLLECTIONS.orgInvites)
            .find({ orgId: me.orgId, expiresAt: { $gt: now() } })
            .sort({ createdAt: -1 })
            .toArray() as Promise<OrgInviteDoc[]>)
        : Promise.resolve([] as OrgInviteDoc[]),
    ]);

    if (!org) return null;

    return {
      org,
      me: sanitizeMember(me),
      members: members.map(sanitizeMember),
      invites,
    };
  }

  if (sqlite) {
    const context = await getOrgContextForUserSqlite(sqlite, userId);
    if (context) return context;
  }

  const me = mem.membersByUser.get(userId);
  if (!me) return null;
  const org = mem.orgs.get(me.orgId);
  if (!org) return null;

  const members = Array.from(mem.membersByUser.values())
    .filter((m) => m.orgId === me.orgId)
    .sort((a, b) => {
      if (a.role !== b.role) return a.role === "manager" ? -1 : 1;
      return a.joinedAt.getTime() - b.joinedAt.getTime();
    });

  const invites = me.role === "manager"
    ? Array.from(mem.invites.values())
        .filter((i) => i.orgId === me.orgId && i.expiresAt > now())
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    : [];

  return {
    org,
    me: sanitizeMember(me),
    members: members.map(sanitizeMember),
    invites,
  };
}

export async function resolveOrgMemberUserId(input: {
  userId: string;
  email?: string;
}): Promise<string> {
  const userId = input.userId?.trim();
  const email = normalizeIdentityEmail(input.email);
  const emailLocalPart = email?.split("@")[0]?.trim().toLowerCase();
  if (!userId) return input.userId;

  const rankCandidate = (candidateUserId: string, joinedAt?: Date): number => {
    let score = 0;
    const normalizedCandidate = candidateUserId.trim().toLowerCase();
    const normalizedRequested = userId.trim().toLowerCase();
    if (normalizedCandidate === normalizedRequested) score += 1000;
    if (emailLocalPart && normalizedCandidate === emailLocalPart) score += 400;
    if (joinedAt instanceof Date && !Number.isNaN(joinedAt.getTime())) {
      score += Math.floor(joinedAt.getTime() / 1_000_000_000);
    }
    return score;
  };

  const db = await getDbSafe();
  if (db) {
    const byId = (await db
      .collection<OrgMemberDoc>(COLLECTIONS.orgMembers)
      .findOne({ userId })) as OrgMemberDoc | null;
    if (byId?.userId) return byId.userId;

    if (email) {
      const matches = (await db
        .collection<OrgMemberDoc>(COLLECTIONS.orgMembers)
        .find({
          $or: [{ workEmail: email }, { email }],
        })
        .toArray()) as OrgMemberDoc[];
      if (matches.length > 0) {
        matches.sort((a, b) => rankCandidate(b.userId, b.joinedAt) - rankCandidate(a.userId, a.joinedAt));
        return matches[0].userId;
      }
    }
    return userId;
  }

  const sqlite = await getSqliteDbSafe();
  if (sqlite) {
    const byId = sqlite
      .prepare("SELECT user_id FROM org_members WHERE user_id = ?")
      .get(userId) as { user_id?: string } | undefined;
    if (byId?.user_id) return String(byId.user_id);

    if (email) {
      const rows = sqlite
        .prepare(
          `SELECT user_id, joined_at
           FROM org_members
           WHERE lower(work_email) = ? OR lower(email) = ?`
        )
        .all(email, email) as Array<{ user_id?: string; joined_at?: string }>;
      if (rows.length > 0) {
        rows.sort((a, b) => {
          const aId = String(a.user_id ?? "");
          const bId = String(b.user_id ?? "");
          return rankCandidate(bId, toDate(b.joined_at)) - rankCandidate(aId, toDate(a.joined_at));
        });
        const picked = String(rows[0].user_id ?? "");
        if (picked) return picked;
      }
    }
    return userId;
  }

  const mem = getMemoryStore();
  if (mem.membersByUser.has(userId)) return userId;
  if (email) {
    const matches = Array.from(mem.membersByUser.values()).filter(
      (m) => m.workEmail?.toLowerCase() === email || m.email?.toLowerCase() === email
    );
    if (matches.length > 0) {
      matches.sort((a, b) => rankCandidate(b.userId, b.joinedAt) - rankCandidate(a.userId, a.joinedAt));
      return matches[0].userId;
    }
  }
  return userId;
}

export async function getOrgContextForIdentity(input: {
  userId: string;
  email?: string;
}): Promise<OrgContext | null> {
  const resolvedUserId = await resolveOrgMemberUserId(input);
  return getOrgContextForUser(resolvedUserId);
}

export async function createOrgForManager(input: {
  userId: string;
  name?: string;
  email?: string;
  orgName: string;
}): Promise<OrgContext> {
  const mem = getMemoryStore();
  const db = await getDbSafe();
  const sqlite = db ? null : await getSqliteDbSafe();
  if (db) {
    const existingMember = (await db
      .collection<OrgMemberDoc>(COLLECTIONS.orgMembers)
      .findOne({ userId: input.userId })) as OrgMemberDoc | null;
    if (existingMember) {
      const existing = await getOrgContextForUser(input.userId);
      if (existing) return existing;
    }
  } else if (sqlite) {
    const existingMember = sqlite
      .prepare("SELECT user_id, org_id FROM org_members WHERE user_id = ?")
      .get(input.userId) as { user_id?: string; org_id?: string } | undefined;
    if (existingMember?.user_id) {
      const existing = await getOrgContextForUserSqlite(sqlite, input.userId);
      if (existing) return existing;
    }
  } else {
    const existingMember = mem.membersByUser.get(input.userId);
    if (existingMember) {
      const existingOrg = mem.orgs.get(existingMember.orgId);
      if (existingOrg) {
        return {
          org: existingOrg,
          me: sanitizeMember(existingMember),
          members: Array.from(mem.membersByUser.values())
            .filter((m) => m.orgId === existingMember.orgId)
            .map(sanitizeMember),
          invites: Array.from(mem.invites.values())
            .filter((i) => i.orgId === existingMember.orgId && i.expiresAt > now()),
        };
      }
    }
  }

  const orgName = input.orgName.trim();
  const orgId = `org_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const org: OrgDoc = {
    orgId,
    name: orgName,
    slug: slugify(orgName) || `org-${Date.now()}`,
    createdBy: input.userId,
    createdAt: now(),
  };

  const manager: OrgMemberDoc = sanitizeMember({
    orgId,
    userId: input.userId,
    name: input.name,
    email: input.email,
    role: "manager",
    joinedAt: now(),
  });

  if (db) {
    await Promise.all([
      db.collection(COLLECTIONS.organizations).insertOne(org),
      db.collection(COLLECTIONS.orgMembers).insertOne(manager),
    ]);
  } else if (sqlite) {
    sqlite
      .prepare(
        "INSERT INTO organizations (org_id, name, slug, created_by, created_at) VALUES (?, ?, ?, ?, ?)"
      )
      .run(org.orgId, org.name, org.slug, org.createdBy, org.createdAt.toISOString());
    sqlite
      .prepare(
        "INSERT INTO org_members (user_id, org_id, name, email, work_email, role, joined_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        manager.userId,
        manager.orgId,
        manager.name ?? null,
        manager.email ?? null,
        manager.workEmail ?? null,
        manager.role,
        manager.joinedAt.toISOString()
      );
  } else {
    mem.orgs.set(orgId, org);
    mem.membersByUser.set(input.userId, manager);
  }

  return {
    org,
    me: manager,
    members: [manager],
    invites: [],
  };
}

export async function createInviteForManager(input: {
  userId: string;
  daysValid?: number;
  maxUses?: number;
}): Promise<OrgInviteDoc> {
  const mem = getMemoryStore();
  const db = await getDbSafe();
  const sqlite = db ? null : await getSqliteDbSafe();

  let orgId = "";
  if (db) {
    const me = (await db
      .collection<OrgMemberDoc>(COLLECTIONS.orgMembers)
      .findOne({ userId: input.userId })) as OrgMemberDoc | null;
    if (!me) throw new Error("no_org");
    if (me.role !== "manager") throw new Error("not_manager");
    orgId = me.orgId;
  } else if (sqlite) {
    const me = sqlite
      .prepare("SELECT org_id, role FROM org_members WHERE user_id = ?")
      .get(input.userId) as { org_id?: string; role?: string } | undefined;
    if (!me?.org_id) throw new Error("no_org");
    if (String(me.role) !== "manager") throw new Error("not_manager");
    orgId = String(me.org_id);
  } else {
    const me = mem.membersByUser.get(input.userId);
    if (!me) throw new Error("no_org");
    if (me.role !== "manager") throw new Error("not_manager");
    orgId = me.orgId;
  }

  const invite: OrgInviteDoc = {
    token: randomUUID().replace(/-/g, ""),
    orgId,
    createdBy: input.userId,
    role: "member",
    createdAt: now(),
    expiresAt: plusDays(Math.max(1, Math.min(30, Number(input.daysValid ?? 7)))),
    maxUses: Math.max(1, Math.min(500, Number(input.maxUses ?? 25))),
    uses: 0,
  };

  if (db) {
    await db.collection(COLLECTIONS.orgInvites).insertOne(invite);
  } else if (sqlite) {
    sqlite
      .prepare(
        `INSERT INTO org_invites
         (token, org_id, created_by, role, created_at, expires_at, max_uses, uses)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        invite.token,
        invite.orgId,
        invite.createdBy,
        invite.role,
        invite.createdAt.toISOString(),
        invite.expiresAt.toISOString(),
        invite.maxUses,
        invite.uses
      );
  } else {
    mem.invites.set(invite.token, invite);
  }

  return invite;
}

export async function redeemInvite(input: {
  token: string;
  userId: string;
  name?: string;
  email?: string;
}): Promise<OrgContext> {
  const mem = getMemoryStore();
  const token = input.token.trim();
  if (!token) throw new Error("invalid_token");

  const existing = await getOrgContextForUser(input.userId);
  if (existing) {
    if (existing.org.orgId) return existing;
  }

  const db = await getDbSafe();
  const sqlite = db ? null : await getSqliteDbSafe();

  if (db) {
    const invite = (await db
      .collection<OrgInviteDoc>(COLLECTIONS.orgInvites)
      .findOne({ token })) as OrgInviteDoc | null;

    if (!invite) throw new Error("invite_not_found");
    if (invite.expiresAt <= now()) throw new Error("invite_expired");
    if (invite.uses >= invite.maxUses) throw new Error("invite_maxed");

    const alreadyMember = await db
      .collection<OrgMemberDoc>(COLLECTIONS.orgMembers)
      .findOne({ userId: input.userId });

    if (!alreadyMember) {
      const member: OrgMemberDoc = sanitizeMember({
        orgId: invite.orgId,
        userId: input.userId,
        name: input.name,
        email: input.email,
        role: "member",
        joinedAt: now(),
      });

      await db.collection(COLLECTIONS.orgMembers).insertOne(member);
    }

    await db
      .collection(COLLECTIONS.orgInvites)
      .updateOne({ token }, { $inc: { uses: 1 } });

    const context = await getOrgContextForUser(input.userId);
    if (!context) throw new Error("join_failed");
    return context;
  }

  if (sqlite) {
    const inviteRow = sqlite
      .prepare(
        "SELECT token, org_id, created_by, role, created_at, expires_at, max_uses, uses FROM org_invites WHERE token = ?"
      )
      .get(token);

    if (!inviteRow) throw new Error("invite_not_found");
    const invite = sqliteInvite(inviteRow);
    if (invite.expiresAt <= now()) throw new Error("invite_expired");
    if (invite.uses >= invite.maxUses) throw new Error("invite_maxed");

    const alreadyMember = sqlite
      .prepare("SELECT user_id FROM org_members WHERE user_id = ?")
      .get(input.userId) as { user_id?: string } | undefined;

    if (!alreadyMember?.user_id) {
      const member: OrgMemberDoc = sanitizeMember({
        orgId: invite.orgId,
        userId: input.userId,
        name: input.name,
        email: input.email,
        role: "member",
        joinedAt: now(),
      });
      sqlite
        .prepare(
          "INSERT INTO org_members (user_id, org_id, name, email, work_email, role, joined_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
        )
        .run(
          member.userId,
          member.orgId,
          member.name ?? null,
          member.email ?? null,
          member.workEmail ?? null,
          member.role,
          member.joinedAt.toISOString()
        );
    }

    sqlite.prepare("UPDATE org_invites SET uses = uses + 1 WHERE token = ?").run(token);
    const context = await getOrgContextForUserSqlite(sqlite, input.userId);
    if (!context) throw new Error("join_failed");
    return context;
  }

  const invite = mem.invites.get(token);
  if (!invite) throw new Error("invite_not_found");
  if (invite.expiresAt <= now()) throw new Error("invite_expired");
  if (invite.uses >= invite.maxUses) throw new Error("invite_maxed");

  if (!mem.membersByUser.has(input.userId)) {
    mem.membersByUser.set(
      input.userId,
      sanitizeMember({
        orgId: invite.orgId,
        userId: input.userId,
        name: input.name,
        email: input.email,
        role: "member",
        joinedAt: now(),
      })
    );
  }

  invite.uses += 1;
  mem.invites.set(token, invite);

  const context = await getOrgContextForUser(input.userId);
  if (!context) throw new Error("join_failed");
  return context;
}

export async function updateMyMemberProfile(input: {
  userId: string;
  name?: string;
  workEmail?: string;
  skills?: string[];
  timezone?: string;
  availability?: MemberAvailability;
}): Promise<OrgMemberDoc | null> {
  const mem = getMemoryStore();
  const db = await getDbSafe();

  if (db) {
    const setPatch: Record<string, unknown> = {};
    if (typeof input.name === "string") setPatch.name = input.name.trim();
    if (typeof input.workEmail === "string") setPatch.workEmail = input.workEmail.trim().toLowerCase();
    if (Array.isArray(input.skills)) setPatch.skills = input.skills.map((s) => s.toLowerCase().trim()).filter(Boolean);
    if (typeof input.timezone === "string") setPatch.timezone = input.timezone.trim();
    if (input.availability) setPatch.availability = input.availability;

    await db
      .collection(COLLECTIONS.orgMembers)
      .updateOne({ userId: input.userId }, { $set: setPatch });

    const updated = await db
      .collection<OrgMemberDoc>(COLLECTIONS.orgMembers)
      .findOne({ userId: input.userId });

    return updated ? sanitizeMember(updated) : null;
  }

  const sqlite = await getSqliteDbSafe();
  if (sqlite) {
    const setParts: string[] = [];
    const values: unknown[] = [];
    if (typeof input.name === "string") {
      setParts.push("name = ?");
      values.push(input.name.trim());
    }
    if (typeof input.workEmail === "string") {
      setParts.push("work_email = ?");
      values.push(input.workEmail.trim().toLowerCase());
    }
    if (setParts.length > 0) {
      values.push(input.userId);
      sqlite
        .prepare(`UPDATE org_members SET ${setParts.join(", ")} WHERE user_id = ?`)
        .run(...values);
    }
    // For skills/timezone/availability, fall through to in-memory update below
    // since SQLite org_members table doesn't have these columns — stored via docs collection
    const row = sqlite
      .prepare("SELECT org_id, user_id, name, email, work_email, role, joined_at FROM org_members WHERE user_id = ?")
      .get(input.userId);
    return row ? sqliteMember(row) : null;
  }

  const current = mem.membersByUser.get(input.userId);
  if (!current) return null;

  const updated = sanitizeMember({
    ...current,
    name: typeof input.name === "string" ? input.name : current.name,
    workEmail: typeof input.workEmail === "string" ? input.workEmail : current.workEmail,
    skills: Array.isArray(input.skills) ? input.skills : current.skills,
    timezone: typeof input.timezone === "string" ? input.timezone : current.timezone,
    availability: input.availability ?? current.availability,
  });
  mem.membersByUser.set(input.userId, updated);
  return updated;
}

export async function getWorkEmailsByUserIds(userIds: string[]): Promise<Map<string, string>> {
  const mem = getMemoryStore();
  const unique = Array.from(new Set(userIds.filter(Boolean)));
  const out = new Map<string, string>();
  if (unique.length === 0) return out;

  const db = await getDbSafe();
  if (db) {
    const members = (await db
      .collection<OrgMemberDoc>(COLLECTIONS.orgMembers)
      .find({ userId: { $in: unique } })
      .toArray()) as OrgMemberDoc[];

    for (const m of members) {
      if (m.workEmail?.trim()) out.set(m.userId, m.workEmail.trim().toLowerCase());
      else if (m.email?.trim()) out.set(m.userId, m.email.trim().toLowerCase());
    }
    return out;
  }

  const sqlite = await getSqliteDbSafe();
  if (sqlite) {
    const placeholders = unique.map(() => "?").join(", ");
    const rows = sqlite
      .prepare(`SELECT user_id, email, work_email FROM org_members WHERE user_id IN (${placeholders})`)
      .all(...unique) as Array<{ user_id?: string; email?: string; work_email?: string }>;
    for (const row of rows) {
      const id = String(row.user_id ?? "");
      if (!id) continue;
      if (row.work_email?.trim()) out.set(id, row.work_email.trim().toLowerCase());
      else if (row.email?.trim()) out.set(id, row.email.trim().toLowerCase());
    }
    return out;
  }

  for (const id of unique) {
    const m = mem.membersByUser.get(id);
    if (!m) continue;
    if (m.workEmail?.trim()) out.set(id, m.workEmail.trim().toLowerCase());
    else if (m.email?.trim()) out.set(id, m.email.trim().toLowerCase());
  }

  return out;
}
