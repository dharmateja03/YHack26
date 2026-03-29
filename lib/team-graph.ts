/**
 * Team Graph Memory
 *
 * Provides skill-based member matching, availability windows, and
 * a "who to involve" context builder for Hermes delegation.
 */

import { getOrgContextForUser, OrgMemberDoc } from "@/lib/org";
import { COLLECTIONS, getDb } from "@/lib/mongodb";

// ── Skill matching ─────────────────────────────────────────────────────────────

/**
 * Find org members whose skills overlap with the requested skills.
 * Case-insensitive substring match (e.g. "react" matches "React.js").
 */
export async function getSkillMatches(
  orgId: string,
  skills: string[]
): Promise<OrgMemberDoc[]> {
  if (!skills.length || !orgId) return [];

  const normalizedSkills = skills.map((s) => s.toLowerCase().trim()).filter(Boolean);

  try {
    const db = await getDb();
    const members = (await db
      .collection(COLLECTIONS.orgMembers)
      .find({ orgId })
      .toArray()) as OrgMemberDoc[];

    return members.filter((m) => {
      const memberSkills = (m.skills ?? []).map((s) => s.toLowerCase());
      return normalizedSkills.some((skill) =>
        memberSkills.some((ms) => ms.includes(skill) || skill.includes(ms))
      );
    });
  } catch {
    return [];
  }
}

// ── Availability ───────────────────────────────────────────────────────────────

interface TimeWindow {
  start: string; // ISO string
  end: string;   // ISO string
}

/**
 * Returns a map of userId → boolean (true = available during the window).
 * Availability is determined by:
 * 1. Member's configured availability hours/days (from OrgMemberDoc)
 * 2. Absence of conflicting calendar events
 */
export async function getMemberAvailability(
  userIds: string[],
  window: TimeWindow
): Promise<Map<string, boolean>> {
  const result = new Map<string, boolean>(userIds.map((id) => [id, true]));

  if (!userIds.length) return result;

  const windowStart = new Date(window.start);
  const windowEnd = new Date(window.end);
  const dayOfWeek = windowStart.getUTCDay(); // 0=Sun, ..., 6=Sat
  const hourOfDay = windowStart.getUTCHours();

  try {
    const db = await getDb();

    // Load member profiles for availability config
    const members = (await db
      .collection(COLLECTIONS.orgMembers)
      .find({ userId: { $in: userIds } })
      .toArray()) as OrgMemberDoc[];

    for (const member of members) {
      if (!member.availability) continue;
      const { days, startHour, endHour } = member.availability;
      if (!days.includes(dayOfWeek) || hourOfDay < startHour || hourOfDay >= endHour) {
        result.set(member.userId, false);
      }
    }

    // Check for conflicting calendar events
    const busyUsers = await db
      .collection(COLLECTIONS.calendars)
      .find({
        userId: { $in: userIds },
        start: { $lt: windowEnd.toISOString() },
        end: { $gt: windowStart.toISOString() },
      })
      .toArray();

    for (const event of busyUsers) {
      if (typeof event.userId === "string") {
        result.set(event.userId, false);
      }
    }
  } catch {
    // If DB is unavailable, assume everyone is available (best-effort)
  }

  return result;
}

// ── "Who to involve" context for Hermes ───────────────────────────────────────

const SKILL_KEYWORDS: Record<string, string[]> = {
  frontend: ["react", "vue", "angular", "css", "html", "ui", "ux", "tailwind", "next"],
  backend:  ["node", "python", "java", "go", "rust", "api", "server", "express", "fastapi"],
  infra:    ["devops", "k8s", "kubernetes", "docker", "ci", "cd", "terraform", "aws", "gcp", "azure"],
  data:     ["sql", "postgres", "mongo", "redis", "analytics", "ml", "ai", "data"],
  security: ["security", "auth", "oauth", "pentest", "soc", "compliance"],
  mobile:   ["ios", "android", "react native", "flutter", "swift", "kotlin"],
  qa:       ["qa", "testing", "jest", "cypress", "selenium", "e2e"],
};

function inferSkillsFromMessage(message: string): string[] {
  const lower = message.toLowerCase();
  const found: string[] = [];
  for (const [area, keywords] of Object.entries(SKILL_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) {
      found.push(area);
      found.push(...keywords.filter((kw) => lower.includes(kw)));
    }
  }
  return Array.from(new Set(found));
}

/**
 * Build a compact context string for Hermes that describes which org members
 * have relevant skills and current availability for a given message/request.
 *
 * Injected as a system message alongside the org roster so Hermes can make
 * smarter "who to involve" decisions by capability rather than just name.
 */
export async function buildInvolvementContext(
  userId: string,
  message: string
): Promise<string> {
  try {
    const orgCtx = await getOrgContextForUser(userId);
    if (!orgCtx) return "";

    const { org, members } = orgCtx;
    if (!members.length) return "";

    const inferredSkills = inferSkillsFromMessage(message);
    const lines: string[] = [`Team skills & availability for org ${org.name}:`];

    // Upcoming window: next 2 hours
    const now = new Date();
    const in2h = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    const availability = await getMemberAvailability(
      members.map((m) => m.userId),
      { start: now.toISOString(), end: in2h.toISOString() }
    );

    for (const m of members.slice(0, 20)) {
      const skillStr = m.skills?.length ? m.skills.slice(0, 5).join(", ") : "no skills listed";
      const avail = availability.get(m.userId) ? "available" : "busy";
      const tzStr = m.timezone ? ` (${m.timezone})` : "";
      const nameLabel = m.name ?? m.userId;
      lines.push(`- ${nameLabel} [${m.userId}] | ${skillStr} | ${avail}${tzStr}`);
    }

    if (inferredSkills.length > 0) {
      // Find skill matches and call them out
      const matches = await getSkillMatches(org.orgId, inferredSkills);
      if (matches.length > 0) {
        const matchNames = matches.slice(0, 3).map((m) => m.name ?? m.userId).join(", ");
        lines.push(`\nBest skill match for this request: ${matchNames}`);
      }
    }

    return lines.join("\n");
  } catch {
    return "";
  }
}
