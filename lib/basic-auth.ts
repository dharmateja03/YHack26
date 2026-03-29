import { randomUUID, createHmac, scryptSync, timingSafeEqual } from "crypto";
import { COLLECTIONS, getDb } from "@/lib/mongodb";
import { getSqliteDbSafe } from "@/lib/sqlite";

export const BASIC_SESSION_COOKIE = "neo_basic_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

interface BasicUserDoc {
  userId: string;
  name: string;
  email: string;
  passwordHash: string;
  passwordSalt: string;
  createdAt: Date;
}

interface SessionPayload {
  userId: string;
  name?: string;
  email?: string;
  exp: number;
}

const memUsersByEmail = new Map<string, BasicUserDoc>();
const memUsersById = new Map<string, BasicUserDoc>();

function getSecret(): string {
  return (
    process.env.BASIC_AUTH_SECRET?.trim() ||
    process.env.AUTH0_SECRET?.trim() ||
    "neosis-dev-basic-auth-secret"
  );
}

function b64url(input: Buffer | string): string {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input, "utf8");
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64urlDecode(input: string): Buffer {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "===".slice((normalized.length + 3) % 4);
  return Buffer.from(padded, "base64");
}

function sign(data: string): string {
  return b64url(createHmac("sha256", getSecret()).update(data).digest());
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 64).toString("hex");
}

function toPublicUser(user: BasicUserDoc): { userId: string; name: string; email: string } {
  return {
    userId: user.userId,
    name: user.name,
    email: user.email,
  };
}

async function getDbSafe() {
  try {
    return await getDb();
  } catch {
    // In production, fail hard when DB is configured but unavailable.
    // In local dev, allow in-memory fallback so auth still works for demos.
    if (process.env.MONGODB_URI?.trim() && process.env.NODE_ENV === "production") {
      throw new Error("db_unavailable");
    }
    return null;
  }
}

export function createBasicSessionToken(input: { userId: string; name?: string; email?: string }): string {
  const payload: SessionPayload = {
    userId: input.userId,
    name: input.name,
    email: input.email,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
  const encoded = b64url(JSON.stringify(payload));
  const sig = sign(encoded);
  return `${encoded}.${sig}`;
}

export function readBasicSessionToken(token?: string | null): SessionPayload | null {
  if (!token) return null;
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;

  const expected = sign(encoded);
  try {
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }

  try {
    const payload = JSON.parse(b64urlDecode(encoded).toString("utf8")) as SessionPayload;
    if (!payload?.userId || typeof payload.exp !== "number") return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function createBasicUser(input: {
  name: string;
  email: string;
  password: string;
}): Promise<{ userId: string; name: string; email: string }> {
  const name = input.name.trim();
  const email = normalizeEmail(input.email);
  const password = input.password;

  if (!name) throw new Error("name_required");
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("invalid_email");
  if (!password || password.length < 6) throw new Error("weak_password");

  const db = await getDbSafe();
  const salt = randomUUID().replace(/-/g, "");
  const user: BasicUserDoc = {
    userId: `user_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    name,
    email,
    passwordSalt: salt,
    passwordHash: hashPassword(password, salt),
    createdAt: new Date(),
  };

  if (db) {
    const col = db.collection<BasicUserDoc>(COLLECTIONS.users);
    const exists = await col.findOne({ email });
    if (exists) throw new Error("email_exists");
    await col.insertOne(user);
    return toPublicUser(user);
  }

  const sqlite = await getSqliteDbSafe();
  if (sqlite) {
    const exists = sqlite
      .prepare("SELECT user_id FROM users WHERE email = ?")
      .get(email) as { user_id?: string } | undefined;
    if (exists?.user_id) throw new Error("email_exists");

    sqlite
      .prepare(
        "INSERT INTO users (user_id, name, email, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(
        user.userId,
        user.name,
        user.email,
        user.passwordHash,
        user.passwordSalt,
        user.createdAt.toISOString()
      );
    return toPublicUser(user);
  }

  if (memUsersByEmail.has(email)) throw new Error("email_exists");
  memUsersByEmail.set(email, user);
  memUsersById.set(user.userId, user);
  return toPublicUser(user);
}

export async function loginBasicUser(input: {
  email: string;
  password: string;
}): Promise<{ userId: string; name: string; email: string }> {
  const email = normalizeEmail(input.email);
  const password = input.password ?? "";
  if (!email || !password) throw new Error("invalid_credentials");

  const db = await getDbSafe();

  if (db) {
    const col = db.collection<BasicUserDoc>(COLLECTIONS.users);
    const user = await col.findOne({ email });
    if (!user) throw new Error("invalid_credentials");
    const hash = hashPassword(password, user.passwordSalt);
    if (hash !== user.passwordHash) throw new Error("invalid_credentials");
    return toPublicUser(user);
  }

  const sqlite = await getSqliteDbSafe();
  if (sqlite) {
    const row = sqlite
      .prepare(
        "SELECT user_id, name, email, password_hash, password_salt, created_at FROM users WHERE email = ?"
      )
      .get(email) as
      | {
          user_id?: string;
          name?: string;
          email?: string;
          password_hash?: string;
          password_salt?: string;
          created_at?: string;
        }
      | undefined;
    if (!row?.user_id || !row.password_hash || !row.password_salt || !row.email || !row.name) {
      throw new Error("invalid_credentials");
    }
    const hash = hashPassword(password, row.password_salt);
    if (hash !== row.password_hash) throw new Error("invalid_credentials");
    return {
      userId: row.user_id,
      name: row.name,
      email: row.email,
    };
  }

  const user = memUsersByEmail.get(email);
  if (!user) throw new Error("invalid_credentials");
  const hash = hashPassword(password, user.passwordSalt);
  if (hash !== user.passwordHash) throw new Error("invalid_credentials");
  return toPublicUser(user);
}
