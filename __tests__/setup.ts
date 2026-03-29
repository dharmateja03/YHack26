// Mock MongoDB — all route tests use this instead of a real connection
const mockPrs = [
  {
    prId: "pr-1",
    title: "feat: add Auth0 login flow",
    author: "sai",
    assignee: "keshav",
    reviewers: ["keshav"],
    approvals: 0,
    requiredApprovals: 1,
    files: ["lib/auth0.ts", "app/api/auth/route.ts"],
    state: "open",
    checks: "pending",
    mergeable: true,
    ticketId: "JIRA-101",
    teamId: "team-1",
    updatedAt: new Date(Date.now() - 30 * 3600_000),
    createdAt: new Date(Date.now() - 30 * 3600_000),
  },
  {
    prId: "pr-2",
    title: "feat: mongodb client",
    author: "dharma",
    assignee: "veda",
    reviewers: ["veda"],
    approvals: 1,
    requiredApprovals: 1,
    files: ["lib/mongodb.ts"],
    state: "open",
    checks: "success",
    mergeable: true,
    ticketId: "JIRA-102",
    teamId: "team-1",
    updatedAt: new Date(Date.now() - 2 * 3600_000),
    createdAt: new Date(Date.now() - 5 * 3600_000),
  },
];

const mockCollection = {
  find: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue(mockPrs) }),
  findOne: jest.fn().mockResolvedValue(mockPrs[0]),
  updateOne: jest.fn().mockResolvedValue({ upsertedCount: 1 }),
  insertOne: jest.fn().mockResolvedValue({ insertedId: "abc" }),
  deleteMany: jest.fn().mockResolvedValue({}),
};

const mockDb = {
  collection: jest.fn().mockReturnValue(mockCollection),
};

jest.mock("../lib/mongodb", () => ({
  getDb: jest.fn().mockResolvedValue(mockDb),
  COLLECTIONS: {
    prs: "prs",
    tickets: "tickets",
    messages: "messages",
    emails: "emails",
    calendars: "calendars",
    briefs: "briefs",
    sprints: "sprints",
    agents: "agents",
    preferences: "preferences",
    conversations: "conversations",
    organizations: "organizations",
    orgMembers: "org_members",
    orgInvites: "org_invites",
  },
}));

// Mock lavaChat — return deterministic JSON for each agent
jest.mock("../lib/lava", () => ({
  MODELS: {
    "neo-brief": "gpt-5-chat-latest",
    "neo-pr": "gpt-5-chat-latest",
    "neo-sched": "gpt-5-chat-latest",
    "neo-root": "gpt-5-chat-latest",
    "neo-sprint": "gpt-5-chat-latest",
    "neo-sprint-notes": "gpt-5-chat-latest",
  },
  lavaChat: jest.fn().mockImplementation((agentId: string) => {
    if (agentId === "neo-pr")
      return Promise.resolve(
        JSON.stringify([
          {
            prId: "pr-1",
            reason: "Unreviewed for 30 hours",
            urgency: "high",
            suggestedAction: "Assign to keshav",
          },
        ])
      );
    if (agentId === "neo-sched")
      return Promise.resolve(
        JSON.stringify({
          slot: {
            start: "2026-03-29T17:00:00Z",
            end: "2026-03-29T17:30:00Z",
          },
          participants: ["user-1", "user-2"],
          confirmationRequired: true,
        })
      );
    return Promise.resolve(JSON.stringify({ result: "mock response" }));
  }),
}));
