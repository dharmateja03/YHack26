// __mocks__/lib/mongodb.ts
// Jest uses this file instead of lib/mongodb.ts for any import that goes through
// the @/ alias (i.e. every route handler).  Tests that import lib/mongodb via a
// relative path (dharma.test.ts lib-unit tests) still hit the real file.

// ─── Collection name constants ────────────────────────────────────────────────

export const COLLECTIONS = {
  prs:         "prs",
  tickets:     "tickets",
  messages:    "messages",
  calendars:   "calendars",
  briefs:      "briefs",
  sprints:     "sprints",
  agents:      "agents",
  preferences: "preferences",
} as const;

// ─── Seed data ────────────────────────────────────────────────────────────────

const NOW   = Date.now();
const DAY   = 24 * 60 * 60 * 1000;

const MOCK_SPRINT = {
  _id:       "sprint-obj-id",
  sprintId:  "sprint-1",
  teamId:    "team-1",
  name:      "Sprint Alpha",
  startDate: new Date(NOW - 7  * DAY).toISOString(),
  endDate:   new Date(NOW + 7  * DAY).toISOString(),
  velocity:  20,
  stories: [
    { id: "s1", title: "Auth refactor",      points: 3, status: "done",        blocked: false },
    { id: "s2", title: "DB migration",       points: 5, status: "done",        blocked: false },
    { id: "s3", title: "Dashboard UI",       points: 3, status: "in-progress", blocked: true  },
    { id: "s4", title: "API rate limiting",  points: 5, status: "todo",        blocked: true  },
    { id: "s5", title: "Sprint forecast",    points: 8, status: "todo",        blocked: false },
  ],
  // Total: 24 pts  |  done: 8  |  blocked: 8
};

const MOCK_PRS = [
  {
    prId:             "pr-1",
    title:            "feat: auth0 integration",
    author:           "keshav",
    body:             "Adds Auth0 AI OAuth token vault for per-user integration tokens.",
    state:            "merged",
    sprintId:         "sprint-1",
    teamId:           "team-1",
    files:            ["lib/auth0.ts", "app/api/auth/route.ts"],
    approvals:        2,
    requiredApprovals: 1,
    checks:           "passing",
    updatedAt:        new Date(NOW - 2  * DAY).toISOString(),
  },
  {
    prId:             "pr-2",
    title:            "feat: mongodb client + seed script",
    author:           "dharma",
    body:             "MongoDB Atlas singleton client and COLLECTIONS constants.",
    state:            "merged",
    sprintId:         "sprint-1",
    teamId:           "team-1",
    files:            ["lib/mongodb.ts", "scripts/seed.ts"],
    approvals:        1,
    requiredApprovals: 1,
    checks:           "passing",
    updatedAt:        new Date(NOW - 1  * DAY).toISOString(),
  },
  {
    prId:             "pr-3",
    title:            "feat: voice brief + elevenlabs streaming",
    author:           "keshav",
    body:             "Streaming TTS integration with ElevenLabs eleven_turbo_v2.",
    state:            "open",
    sprintId:         "sprint-1",
    teamId:           "team-1",
    files:            ["lib/elevenlabs.ts", "app/api/agents/brief/route.ts"],
    approvals:        0,
    requiredApprovals: 1,
    checks:           "passing",
    updatedAt:        new Date(NOW - 26 * 60 * 60 * 1000).toISOString(), // stale: 26h
    waitHours:        26,
  },
];

const MOCK_TICKETS = [
  {
    ticketId:  "NEOSIS-1",
    title:     "Auth tokens not refreshing after expiry",
    priority:  1,
    status:    "In Progress",
    assignee:  "user-1",
    teamId:    "team-1",
    blockedBy: [],
  },
  {
    ticketId:  "NEOSIS-2",
    title:     "Sprint forecast voice not streaming",
    priority:  2,
    status:    "Open",
    assignee:  "user-1",
    teamId:    "team-1",
    blockedBy: ["pr-3"],
  },
];

const MOCK_BRIEFS = [
  {
    _id:       "brief-obj-1",
    userId:    "user-1",
    type:      "morning",
    script:    "Good morning. You have two meetings today, starting with standup at nine.",
    createdAt: new Date(NOW - DAY).toISOString(),
  },
];

// ─── Cursor factory ────────────────────────────────────────────────────────────
// Supports the following call patterns used in the codebase:
//   collection.find(filter).toArray()
//   collection.find(filter).sort(s).toArray()
//   collection.find(filter).sort(s).limit(n).toArray()
//   collection.find(filter).sort(s).limit(1).next()

class MockCursor {
  private name: string;

  constructor(name: string) {
    this.name = name;
  }

  sort(_spec: unknown): this { return this; }
  limit(_n: number): this   { return this; }

  async toArray(): Promise<unknown[]> {
    switch (this.name) {
      case "prs":     return MOCK_PRS;
      case "tickets": return MOCK_TICKETS;
      case "sprints": return [MOCK_SPRINT];
      case "briefs":  return MOCK_BRIEFS;
      default:        return [];
    }
  }

  async next(): Promise<unknown> {
    switch (this.name) {
      case "sprints": return MOCK_SPRINT;
      case "briefs":  return MOCK_BRIEFS[0] ?? null;
      default:        return null;
    }
  }
}

// ─── Collection factory ────────────────────────────────────────────────────────

function makeCollection(name: string) {
  return {
    find(_filter?: unknown): MockCursor {
      return new MockCursor(name);
    },

    async findOne(_filter?: unknown, _options?: unknown): Promise<unknown> {
      switch (name) {
        case "sprints": return MOCK_SPRINT;
        case "prs":     return MOCK_PRS[0] ?? null;
        case "briefs":  return MOCK_BRIEFS[0] ?? null;
        default:        return null;
      }
    },

    async insertOne(_doc: unknown): Promise<{ insertedId: string }> {
      return { insertedId: `mock-id-${Date.now()}` };
    },

    async updateOne(
      _filter: unknown,
      _update: unknown,
      _options?: unknown,
    ): Promise<{ modifiedCount: number }> {
      return { modifiedCount: 1 };
    },

    async countDocuments(_filter?: unknown): Promise<number> {
      switch (name) {
        case "prs":     return MOCK_PRS.length;
        case "tickets": return MOCK_TICKETS.length;
        default:        return 0;
      }
    },
  };
}

// ─── Mock DB ──────────────────────────────────────────────────────────────────

const MOCK_DB = {
  collection(name: string) {
    return makeCollection(name);
  },
};

// ─── Exported getDb ───────────────────────────────────────────────────────────

export async function getDb(): Promise<typeof MOCK_DB> {
  return MOCK_DB;
}
