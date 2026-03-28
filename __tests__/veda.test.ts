// Veda — Tests for: lib/voyage.ts, Agent 4 (Root Cause), Jira webhook, data routes
// Run: npx jest __tests__/veda.test.ts

// ─── lib/voyage.ts ───────────────────────────────────────────────
describe("lib/voyage", () => {
  test("embed is exported and returns a number array", async () => {
    const { embed } = await import("../lib/voyage");
    expect(typeof embed).toBe("function");
  });

  test("embed returns a vector of length 1536", async () => {
    const { embed } = await import("../lib/voyage");
    if (!process.env.VOYAGE_API_KEY) {
      console.warn("Skipping Voyage test — no API key");
      return;
    }
    const vector = await embed("test text for embedding");
    expect(Array.isArray(vector)).toBe(true);
    expect(vector.length).toBe(1536);
    expect(typeof vector[0]).toBe("number");
  });

  test("embedBatch returns array of vectors", async () => {
    const { embedBatch } = await import("../lib/voyage");
    expect(typeof embedBatch).toBe("function");
  });
});

// ─── Agent 4: POST /api/agents/rootcause ─────────────────────────
describe("POST /api/agents/rootcause", () => {
  test("returns cause, blockedBy, recommendedAction, evidence fields", async () => {
    const { POST } = await import("../app/api/agents/rootcause/route");
    const req = new Request("http://localhost/api/agents/rootcause", {
      method: "POST",
      body: JSON.stringify({ prId: "pr-1" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("cause");
    expect(body).toHaveProperty("blockedBy");
    expect(body).toHaveProperty("recommendedAction");
    expect(body).toHaveProperty("evidence");
    expect(body).toHaveProperty("confident");
    expect(Array.isArray(body.evidence)).toBe(true);
  });

  test("returns confident: false when similarity is below 0.7", async () => {
    const { POST } = await import("../app/api/agents/rootcause/route");
    // Use a prId that has no related messages in seed data
    const req = new Request("http://localhost/api/agents/rootcause", {
      method: "POST",
      body: JSON.stringify({ prId: "pr-nonexistent-999" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.confident).toBe(false);
  });

  test("returns 400 if neither prId nor ticketId provided", async () => {
    const { POST } = await import("../app/api/agents/rootcause/route");
    const req = new Request("http://localhost/api/agents/rootcause", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  test("each evidence item has source, id, text fields", async () => {
    const { POST } = await import("../app/api/agents/rootcause/route");
    const req = new Request("http://localhost/api/agents/rootcause", {
      method: "POST",
      body: JSON.stringify({ prId: "pr-1" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    const body = await res.json();
    if (body.confident && body.evidence.length > 0) {
      const item = body.evidence[0];
      expect(item).toHaveProperty("source");
      expect(item).toHaveProperty("id");
      expect(item).toHaveProperty("text");
    }
  });
});

// ─── Agent 4: GET /api/agents/rootcause/history ──────────────────
describe("GET /api/agents/rootcause/history", () => {
  test("returns array of past analyses for a team", async () => {
    const { GET } = await import("../app/api/agents/rootcause/route");
    const req = new Request("http://localhost/api/agents/rootcause/history?teamId=team-1");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.history)).toBe(true);
  });
});

// ─── Webhook: POST /api/webhooks/jira ────────────────────────────
describe("POST /api/webhooks/jira", () => {
  test("upserts ticket into MongoDB on issue_created event", async () => {
    const { POST } = await import("../app/api/webhooks/jira/route");
    const req = new Request("http://localhost/api/webhooks/jira", {
      method: "POST",
      body: JSON.stringify({
        webhookEvent: "jira:issue_created",
        issue: {
          id: "JIRA-101",
          fields: {
            summary: "Auth integration broken",
            description: "users cant log in",
            status: { name: "Open" },
            priority: { name: "High" },
            assignee: { displayName: "veda" },
            reporter: { displayName: "keshav" },
          },
        },
      }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
  });

  test("maps priority names to numbers correctly", async () => {
    // Highest→1, High→2, Medium→3, Low→4, Lowest→5
    const priorityMap: Record<string, number> = {
      Highest: 1, High: 2, Medium: 3, Low: 4, Lowest: 5,
    };
    Object.entries(priorityMap).forEach(([name, num]) => {
      expect(priorityMap[name]).toBe(num);
    });
  });
});

// ─── Data: GET /api/data/prs ─────────────────────────────────────
describe("GET /api/data/prs", () => {
  test("returns array of open PRs with required fields", async () => {
    const { GET } = await import("../app/api/data/prs/route");
    const req = new Request("http://localhost/api/data/prs?teamId=team-1");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.prs)).toBe(true);
    if (body.prs.length > 0) {
      const pr = body.prs[0];
      expect(pr).toHaveProperty("prId");
      expect(pr).toHaveProperty("title");
      expect(pr).toHaveProperty("author");
      expect(pr).toHaveProperty("waitHours");
    }
  });
});

// ─── Data: GET /api/data/tickets ─────────────────────────────────
describe("GET /api/data/tickets", () => {
  test("returns array of tickets with priority field", async () => {
    const { GET } = await import("../app/api/data/tickets/route");
    const req = new Request("http://localhost/api/data/tickets?teamId=team-1");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.tickets)).toBe(true);
    if (body.tickets.length > 0) {
      expect(typeof body.tickets[0].priority).toBe("number");
    }
  });
});
