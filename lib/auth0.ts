// Auth0 AI client + OAuth token vault helpers
// Uses in-memory vault backed by Auth0 Management API env vars in production

type Integration = "github" | "slack" | "jira" | "calendar";

// In-memory vault for dev/test; in production swap for Auth0 Management API calls
const vault = new Map<string, string>();

function isMasterDevUser(userId: string): boolean {
  const master = process.env.MASTER_USER_ID?.trim();
  return Boolean(master && userId === master);
}

export async function getTokenForUser(
  userId: string,
  integration: Integration | string
): Promise<string | null> {
  const key = `${userId}:${integration}`;
  if (vault.has(key)) return vault.get(key)!;

  // Local dev master account should stay fully local for speed/reliability.
  if (isMasterDevUser(userId)) return null;

  // Production: retrieve from Auth0 token vault via Management API
  if (
    process.env.AUTH0_ISSUER_BASE_URL &&
    process.env.AUTH0_CLIENT_ID &&
    process.env.AUTH0_CLIENT_SECRET
  ) {
    try {
      const tokenRes = await fetch(
        `${process.env.AUTH0_ISSUER_BASE_URL}/oauth/token`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: process.env.AUTH0_CLIENT_ID,
            client_secret: process.env.AUTH0_CLIENT_SECRET,
            audience: `${process.env.AUTH0_ISSUER_BASE_URL}/api/v2/`,
            grant_type: "client_credentials",
          }),
        }
      );
      if (!tokenRes.ok) return null;
      const { access_token: mgmtToken } = await tokenRes.json();

      const userRes = await fetch(
        `${process.env.AUTH0_ISSUER_BASE_URL}/api/v2/users/${encodeURIComponent(userId)}`,
        { headers: { Authorization: `Bearer ${mgmtToken}` } }
      );
      if (!userRes.ok) return null;
      const user = await userRes.json();
      const stored = user?.app_metadata?.[`${integration}_token`];
      if (stored) {
        vault.set(key, stored);
        return stored;
      }
    } catch {
      // fall through
    }
  }

  return null;
}

export async function saveToken(
  userId: string,
  integration: Integration | string,
  token: string
): Promise<void> {
  const key = `${userId}:${integration}`;
  vault.set(key, token);

  // Local dev master account should stay fully local for speed/reliability.
  if (isMasterDevUser(userId)) return;

  // Production: persist to Auth0 app_metadata via Management API
  if (
    process.env.AUTH0_ISSUER_BASE_URL &&
    process.env.AUTH0_CLIENT_ID &&
    process.env.AUTH0_CLIENT_SECRET
  ) {
    try {
      const tokenRes = await fetch(
        `${process.env.AUTH0_ISSUER_BASE_URL}/oauth/token`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: process.env.AUTH0_CLIENT_ID,
            client_secret: process.env.AUTH0_CLIENT_SECRET,
            audience: `${process.env.AUTH0_ISSUER_BASE_URL}/api/v2/`,
            grant_type: "client_credentials",
          }),
        }
      );
      if (!tokenRes.ok) return;
      const { access_token: mgmtToken } = await tokenRes.json();

      await fetch(
        `${process.env.AUTH0_ISSUER_BASE_URL}/api/v2/users/${encodeURIComponent(userId)}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${mgmtToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            app_metadata: { [`${integration}_token`]: token },
          }),
        }
      );
    } catch {
      // vault.set above already stores it in-memory
    }
  }
}
