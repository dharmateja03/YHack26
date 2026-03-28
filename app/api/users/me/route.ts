import { getTokenForUser, saveToken } from "@/lib/auth0";

const INTEGRATIONS = ["github", "slack", "jira", "calendar"] as const;

export async function GET(_req: Request) {
  let session: { user?: { sub?: string; name?: string; email?: string } } | null = null;

  try {
    // getSession() requires Next.js headers — not available in test env
    const { getSession } = await import("@auth0/nextjs-auth0");
    session = await getSession();
  } catch {
    // not in Next.js runtime
  }

  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { sub: userId, name, email } = session.user;

  const connected: Record<string, boolean> = {};
  for (const integration of INTEGRATIONS) {
    const token = await getTokenForUser(userId ?? "", integration);
    connected[integration] = token !== null;
  }

  return Response.json({ userId, name, email, connected });
}

// POST /api/auth/connect/:integration — trigger OAuth redirect
export async function POST(req: Request) {
  const url = new URL(req.url);
  const segments = url.pathname.split("/");
  const integration = segments[segments.length - 1];

  if (!INTEGRATIONS.includes(integration as (typeof INTEGRATIONS)[number])) {
    return Response.json({ error: "Unknown integration" }, { status: 400 });
  }

  // Redirect to Auth0 for the integration OAuth flow
  const loginUrl = `${process.env.AUTH0_BASE_URL ?? ""}/api/auth/login?connection=${integration}`;
  return Response.json({ redirectUrl: loginUrl });
}

// DELETE /api/auth/disconnect/:integration — revoke token
export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const segments = url.pathname.split("/");
  const integration = segments[segments.length - 1];

  if (!INTEGRATIONS.includes(integration as (typeof INTEGRATIONS)[number])) {
    return Response.json({ error: "Unknown integration" }, { status: 400 });
  }

  let session: { user?: { sub?: string } } | null = null;
  try {
    const { getSession } = await import("@auth0/nextjs-auth0");
    session = await getSession();
  } catch {
    // not in Next.js runtime
  }

  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Overwrite with empty string to effectively revoke
  await saveToken(session.user.sub ?? "", integration, "");

  return Response.json({ disconnected: true });
}
