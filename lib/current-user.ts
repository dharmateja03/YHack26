export interface SessionUser {
  userId: string;
  name?: string;
  email?: string;
  source?: "basic" | "dev_cookie" | "master";
}

export async function getSessionUser(): Promise<SessionUser | null> {
  try {
    const { cookies } = await import("next/headers");
    const { BASIC_SESSION_COOKIE, readBasicSessionToken } = await import("@/lib/basic-auth");
    const c = cookies();
    const token = c.get(BASIC_SESSION_COOKIE)?.value;
    const parsed = readBasicSessionToken(token);
    if (parsed?.userId) {
      return {
        userId: parsed.userId,
        name: parsed.name,
        email: parsed.email,
        source: "basic",
      };
    }
  } catch {
    // fall through
  }

  try {
    const { cookies, headers } = await import("next/headers");
    const h = headers();
    const c = cookies();

    const userId =
      h.get("x-neo-dev-user-id")?.trim() ||
      c.get("neo_dev_user_id")?.value?.trim();
    if (userId) {
      return {
        userId,
        name:
          h.get("x-neo-dev-user-name")?.trim() ||
          c.get("neo_dev_user_name")?.value?.trim() ||
          undefined,
        email:
          h.get("x-neo-dev-user-email")?.trim() ||
          c.get("neo_dev_user_email")?.value?.trim() ||
          undefined,
        source: "dev_cookie",
      };
    }
  } catch {
    // fall through
  }

  const allowMasterFallback = process.env.ENABLE_MASTER_FALLBACK === "true";
  if (!allowMasterFallback) return null;

  const masterUserId = process.env.MASTER_USER_ID?.trim();
  if (!masterUserId) return null;

  return {
    userId: masterUserId,
    name: process.env.MASTER_USER_NAME?.trim() || "Master User",
    email: process.env.MASTER_USER_EMAIL?.trim() || undefined,
    source: "master",
  };
}
