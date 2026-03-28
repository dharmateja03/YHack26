// __mocks__/lib/lava.ts
// Jest mock for lib/lava.ts — used automatically via moduleNameMapper for @/lib/lava imports.
// Route handlers get this instead of the real Lava gateway, so tests run without an API key.

export const MODELS: Record<string, string> = {
  "neo-brief":        "claude-haiku-4-5-20251001",
  "neo-pr":           "groq/llama-3.1-70b-versatile",
  "neo-sched":        "claude-sonnet-4-6",
  "neo-root":         "claude-sonnet-4-6",
  "neo-sprint":       "claude-sonnet-4-6",
  "neo-sprint-notes": "groq/llama-3.1-70b-versatile",
};

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export async function lavaChat(
  agentId: string,
  _messages: ChatMessage[]
): Promise<string> {
  switch (agentId) {
    case "neo-brief":
      return (
        "Good morning. You have two meetings today — standup at nine and a design review at two. " +
        "Your auth refactor pull request has been waiting eighteen hours for review and is your most urgent item. " +
        "There are no P1 tickets assigned to you right now. " +
        "Your teammate Alex is blocked on the database migration and could use a second pair of eyes this afternoon. " +
        "Your single priority today: get that auth PR reviewed and unblock Alex before the design review."
      );

    case "neo-sprint":
      return JSON.stringify({
        onTrack: true,
        pointsAtRisk: 4,
        bottleneck: "Three unreviewed PRs are the primary bottleneck this sprint.",
        recommendation:
          "Redistribute two stale PRs to reviewers with lighter calendars today.",
      });

    case "neo-sprint-notes":
      return JSON.stringify({
        internal:
          "This sprint we merged two PRs: auth refactor (pr-1) which migrated the login flow to Auth0, " +
          "and DB migration setup (pr-2) which configured the MongoDB Atlas cluster. " +
          "Eight story points completed of twenty-four total. One story blocked by pending design review.",
        external:
          "We shipped a more secure and faster login experience in this release. " +
          "Under the hood we improved backend reliability and set the foundation for upcoming features.",
      });

    case "neo-pr":
      return JSON.stringify([
        {
          prId: "pr-3",
          blockedBy: "No reviewers assigned",
          suggestion: "Route to dharma — highest file overlap with this PR",
          waitHours: 26,
        },
      ]);

    case "neo-sched":
      return JSON.stringify({
        slot: {
          start: "2026-03-29T17:00:00Z",
          end: "2026-03-29T17:30:00Z",
        },
        participants: ["user-1", "user-2"],
        confirmationRequired: true,
      });

    case "neo-root":
      return JSON.stringify({
        cause: "The PR is delayed because the design approval from Mark is pending.",
        blockedBy: "mark@example.com",
        recommendedAction:
          "Escalate to Mark's manager or reassign the design review to an available designer.",
        evidence: [
          {
            source: "slack",
            id: "msg-001",
            text: "Hey Mark, still waiting on your sign-off for the dashboard PR.",
          },
        ],
        confident: true,
      });

    default:
      return `Mock Lava response for agent: ${agentId}`;
  }
}
