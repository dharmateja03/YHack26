import { getTokenForUser, saveToken } from "@/lib/auth0";
import { getSessionUser } from "@/lib/current-user";
import { resolveOrgMemberUserId } from "@/lib/org";

const INTEGRATIONS = ["github", "slack", "jira", "calendar"] as const;

export async function GET(_req: Request) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const resolvedUserId = await resolveOrgMemberUserId({
    userId: sessionUser.userId,
    email: sessionUser.email,
  });
  const { name, email } = sessionUser;
  const userId = resolvedUserId || sessionUser.userId;
  const url = new URL(_req.url);
  const lite = url.searchParams.get("lite") === "1";
  if (lite) {
    return Response.json({ userId, name, email });
  }

  const connected: Record<string, boolean> = {};
  for (const integration of INTEGRATIONS) {
    const token = await getTokenForUser(userId, integration);
    const legacy =
      userId !== sessionUser.userId
        ? await getTokenForUser(sessionUser.userId, integration)
        : null;
    connected[integration] = Boolean((token || legacy || "").trim());
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

  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const resolvedUserId = await resolveOrgMemberUserId({
    userId: sessionUser.userId,
    email: sessionUser.email,
  });
  // Overwrite with empty string to effectively revoke
  await saveToken(resolvedUserId || sessionUser.userId, integration, "");
  if (resolvedUserId && resolvedUserId !== sessionUser.userId) {
    await saveToken(sessionUser.userId, integration, "");
  }

  return Response.json({ disconnected: true });
}
