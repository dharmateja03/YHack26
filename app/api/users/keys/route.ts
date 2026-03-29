import { getSessionUser } from "@/lib/current-user";
import { getTokenForUser, saveToken } from "@/lib/auth0";
import { resolveOrgMemberUserId } from "@/lib/org";

const INTEGRATIONS = ["github", "slack", "jira", "calendar"] as const;
type Integration = (typeof INTEGRATIONS)[number];

function isIntegration(value: string): value is Integration {
  return INTEGRATIONS.includes(value as Integration);
}

async function verifyKey(
  integration: Integration,
  token: string,
  extra?: { jiraDomain?: string; jiraEmail?: string }
): Promise<{ ok: boolean; reason?: string; accountName?: string }> {
  if (integration === "github") {
    if (!/^(gh[pous]_|github_pat_)/i.test(token)) {
      return { ok: false, reason: "GitHub token should start with ghp_/gho_/ghu_/ghs_/github_pat_." };
    }
    try {
      const res = await fetch("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
        },
      });
      if (!res.ok) return { ok: false, reason: "GitHub token verification failed." };
      const data = await res.json().catch(() => ({})) as { login?: string };
      return { ok: true, accountName: data.login };
    } catch {
      return { ok: false, reason: "Could not reach GitHub to verify token." };
    }
  }

  if (integration === "slack") {
    if (!/^(xox[baprs]-|xoxe\.)/i.test(token)) {
      return { ok: false, reason: "Slack token should start with xoxb-/xoxp-/xapp-." };
    }
    try {
      const res = await fetch("https://slack.com/api/auth.test", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; team?: string; user?: string };
      if (!data.ok) return { ok: false, reason: "Slack token verification failed." };
      const accountName = data.team ? `${data.user ?? "user"} @ ${data.team}` : data.user;
      return { ok: true, accountName };
    } catch {
      return { ok: false, reason: "Could not reach Slack to verify token." };
    }
  }

  if (integration === "calendar") {
    if (!/^nyk_/i.test(token)) {
      return { ok: false, reason: "Nylas API key should start with nyk_." };
    }
    const baseUrl = process.env.NYLAS_API_BASE_URL?.trim() || "https://api.us.nylas.com";
    try {
      const res = await fetch(`${baseUrl}/v3/connectors`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      });
      if (res.status === 401 || res.status === 403) {
        return { ok: false, reason: "Nylas key verification failed." };
      }
      // Try to get a grant email
      const grantsRes = await fetch(`${baseUrl}/v3/grants`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      }).catch(() => null);
      if (grantsRes?.ok) {
        const grantsData = await grantsRes.json().catch(() => ({})) as { data?: Array<{ email?: string }> };
        const email = grantsData.data?.[0]?.email;
        if (email) return { ok: true, accountName: email };
      }
    } catch {
      return { ok: false, reason: "Could not reach Nylas to verify key." };
    }
    return { ok: true };
  }

  if (integration === "jira") {
    if (token.length < 8) {
      return { ok: false, reason: "Jira token looks too short." };
    }
    // Live Jira verification if domain and email are provided
    const domain = extra?.jiraDomain?.trim();
    const email = extra?.jiraEmail?.trim();
    if (domain && email) {
      try {
        const credentials = Buffer.from(`${email}:${token}`).toString("base64");
        const res = await fetch(`https://${domain}.atlassian.net/rest/api/3/myself`, {
          headers: {
            Authorization: `Basic ${credentials}`,
            Accept: "application/json",
          },
        });
        if (!res.ok) return { ok: false, reason: `Jira verification failed (${res.status}). Check domain, email, and API token.` };
        const data = await res.json().catch(() => ({})) as { displayName?: string; emailAddress?: string };
        return { ok: true, accountName: data.displayName ?? data.emailAddress };
      } catch {
        return { ok: false, reason: "Could not reach Jira to verify token." };
      }
    }
    return { ok: true };
  }

  return { ok: true };
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const resolvedUserId =
    (await resolveOrgMemberUserId({ userId: user.userId, email: user.email })) ||
    user.userId;

  const configured: Record<Integration, boolean> = {
    github: false,
    slack: false,
    jira: false,
    calendar: false,
  };

  for (const integration of INTEGRATIONS) {
    const token = await getTokenForUser(resolvedUserId, integration);
    const legacy =
      resolvedUserId !== user.userId
        ? await getTokenForUser(user.userId, integration)
        : null;
    configured[integration] = Boolean((token || legacy || "").trim());
  }

  return Response.json({ configured });
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    integration?: string;
    token?: string;
    jiraDomain?: string;
    jiraEmail?: string;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.integration || !isIntegration(body.integration)) {
    return Response.json({ error: "Invalid integration" }, { status: 400 });
  }

  const token = (body.token ?? "").trim();
  if (!token) {
    return Response.json({ error: "token is required" }, { status: 400 });
  }

  const verified = await verifyKey(body.integration, token, {
    jiraDomain: body.jiraDomain,
    jiraEmail: body.jiraEmail,
  });
  if (!verified.ok) {
    return Response.json({ error: verified.reason ?? "Token verification failed." }, { status: 400 });
  }

  const resolvedUserId =
    (await resolveOrgMemberUserId({ userId: user.userId, email: user.email })) ||
    user.userId;
  await saveToken(resolvedUserId, body.integration, token);
  if (resolvedUserId !== user.userId) {
    await saveToken(user.userId, body.integration, token);
  }
  return Response.json({
    saved: true,
    integration: body.integration,
    verified: true,
    accountName: verified.accountName,
  });
}

export async function DELETE(req: Request) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { integration?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.integration || !isIntegration(body.integration)) {
    return Response.json({ error: "Invalid integration" }, { status: 400 });
  }

  const resolvedUserId =
    (await resolveOrgMemberUserId({ userId: user.userId, email: user.email })) ||
    user.userId;
  await saveToken(resolvedUserId, body.integration, "");
  if (resolvedUserId !== user.userId) {
    await saveToken(user.userId, body.integration, "");
  }
  return Response.json({ removed: true, integration: body.integration });
}
