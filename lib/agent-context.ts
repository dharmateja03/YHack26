import { getSessionUser } from "@/lib/current-user";
import { getOrgContextForUser } from "@/lib/org";

export interface TeamAwarenessContext {
  userId: string;
  teamId: string;
  orgSummary: string;
}

export async function resolveTeamAwareness(input?: {
  userId?: string;
  teamId?: string;
  fallbackUserId?: string;
  fallbackTeamId?: string;
}): Promise<TeamAwarenessContext> {
  const sessionUser = await getSessionUser().catch(() => null);
  const resolvedUserId =
    input?.userId?.trim() ||
    sessionUser?.userId?.trim() ||
    input?.fallbackUserId ||
    "user-1";

  let resolvedTeamId = input?.teamId?.trim() || input?.fallbackTeamId || "team-1";
  let orgSummary = "Org roster unavailable.";

  try {
    const org = await getOrgContextForUser(resolvedUserId);
    if (org?.org) {
      if (!input?.teamId?.trim()) {
        resolvedTeamId = org.org.slug || org.org.orgId || resolvedTeamId;
      }

      const members = org.members
        .slice(0, 40)
        .map((m) =>
          [
            m.name?.trim(),
            m.userId?.trim(),
            m.workEmail?.trim().toLowerCase() || m.email?.trim().toLowerCase(),
            m.role,
          ]
            .filter(Boolean)
            .join(" | ")
        );

      orgSummary = [
        `Org: ${org.org.name} (${org.org.slug || org.org.orgId})`,
        `Current user: ${org.me.name || org.me.userId} (${org.me.userId})`,
        "Team members:",
        ...members.map((m) => `- ${m}`),
      ].join("\n");
    }
  } catch {
    // Best-effort context.
  }

  return {
    userId: resolvedUserId,
    teamId: resolvedTeamId,
    orgSummary,
  };
}

