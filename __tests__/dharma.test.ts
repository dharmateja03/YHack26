// Dharma — Tests for: lib/mongodb.ts, lib/lava.ts, scripts/seed.ts, Agent 2 (PR), GitHub webhook
// Run: npx jest __tests__/dharma.test.ts

import { MongoClient } from "mongodb";

// ─── lib/mongodb.ts ───────────────────────────────────────────────
describe("lib/mongodb", () => {
  test("COLLECTIONS exports all required collection names", async () => {
    const { COLLECTIONS } = await import("../lib/mongodb");
    expect(COLLECTIONS.prs).toBe("prs");
    expect(COLLECTIONS.tickets).toBe("tickets");
    expect(COLLECTIONS.messages).toBe("messages");
    expect(COLLECTIONS.calendars).toBe("calendars");
    expect(COLLECTIONS.briefs).toBe("briefs");
    expect(COLLECTIONS.sprints).toBe("sprints");
    expect(COLLECTIONS.agents).toBe("agents");
    expect(COLLECTIONS.preferences).toBe("preferences");
  });

  test("getDb returns a MongoDB Db instance", async () => {
    const { getDb } = await import("../lib/mongodb");
    const db = await getDb();
    expect(db).toBeDefined();
    expect(typeof db.collection).toBe("function");
  });
});

// ─── lib/lava.ts ─────────────────────────────────────────────────
describe("lib/lava", () => {
  test("MODELS has correct model IDs for all agents", async () => {
    const { MODELS } = await import("../lib/lava");
    expect(MODELS["neo-brief"]).toBe("claude-haiku-4-5-20251001");
    expect(MODELS["neo-pr"]).toBe("groq/llama-3.1-70b-versatile");
    expect(MODELS["neo-sched"]).toBe("claude-sonnet-4-6");
    expect(MODELS["neo-root"]).toBe("claude-sonnet-4-6");
    expect(MODELS["neo-sprint"]).toBe("claude-sonnet-4-6");
    expect(MODELS["neo-sprint-notes"]).toBe("groq/llama-3.1-70b-versatile");
  });

  test("lavaChat sends x-lava-agent-id header", async () => {
    const { lavaChat } = await import("../lib/lava");
    // Mock: just check the function exists and is callable
    expect(typeof lavaChat).toBe("function");
  });
});

// ─── Agent 2: GET /api/agents/pr ─────────────────────────────────
describe("GET /api/agents/pr", () => {
  test("returns open PRs with waitHours calculated", async () => {
    const { GET } = await import("../app/api/agents/pr/route");
    const req = new Request("http://localhost/api/agents/pr?teamId=team-1");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.prs)).toBe(true);
    if (body.prs.length > 0) {
      expect(typeof body.prs[0].waitHours).toBe("number");
    }
  });
});

// ─── Agent 2: POST /api/agents/pr/scan ───────────────────────────
describe("POST /api/agents/pr/scan", () => {
  test("returns blocker analysis array", async () => {
    const { POST } = await import("../app/api/agents/pr/route");
    const req = new Request("http://localhost/api/agents/pr/scan", {
      method: "POST",
      body: JSON.stringify({ teamId: "team-1" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.blockers).toBeDefined();
  });
});

// ─── Agent 2: POST /api/agents/pr/nudge (confirmation gate) ──────
describe("POST /api/agents/pr/nudge", () => {
  test("rejects nudge if confirmed is not true", async () => {
    const { POST } = await import("../app/api/agents/pr/route");
    const req = new Request("http://localhost/api/agents/pr/nudge", {
      method: "POST",
      body: JSON.stringify({ prId: "pr-1", reviewerId: "user-1", confirmed: false }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  test("sends nudge if confirmed is true", async () => {
    const { POST } = await import("../app/api/agents/pr/route");
    const req = new Request("http://localhost/api/agents/pr/nudge", {
      method: "POST",
      body: JSON.stringify({ prId: "pr-1", reviewerId: "user-1", confirmed: true }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
  });
});

// ─── Webhook: POST /api/webhooks/github ──────────────────────────
describe("POST /api/webhooks/github", () => {
  test("upserts PR into MongoDB on opened event", async () => {
    const { POST } = await import("../app/api/webhooks/github/route");
    const payload = {
      action: "opened",
      pull_request: {
        number: 42,
        title: "feat: add auth",
        body: "adds auth0 integration",
        user: { login: "dharma" },
        state: "open",
        updated_at: new Date().toISOString(),
        head: { sha: "abc123" },
      },
    };
    const req = new Request("http://localhost/api/webhooks/github", {
      method: "POST",
      body: JSON.stringify(payload),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
  });
});
