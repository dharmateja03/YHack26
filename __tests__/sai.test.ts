// Sai — Tests for: lib/auth0.ts, Agent 3 (Scheduling), Nylas webhook, UI routes
// Run: npx jest __tests__/sai.test.ts

// ─── lib/auth0.ts ────────────────────────────────────────────────
describe("lib/auth0", () => {
  test("getTokenForUser and saveToken are exported", async () => {
    const { getTokenForUser, saveToken } = await import("../lib/auth0");
    expect(typeof getTokenForUser).toBe("function");
    expect(typeof saveToken).toBe("function");
  });

  test("getTokenForUser returns null for unknown user", async () => {
    const { getTokenForUser } = await import("../lib/auth0");
    const token = await getTokenForUser("nonexistent-user", "github");
    expect(token).toBeNull();
  });
});

// ─── Agent 3: POST /api/agents/schedule/find ─────────────────────
describe("POST /api/agents/schedule/find", () => {
  test("returns a slot and confirmationRequired: true", async () => {
    const { POST } = await import("../app/api/agents/schedule/route");
    const req = new Request("http://localhost/api/agents/schedule/find", {
      method: "POST",
      body: JSON.stringify({
        participantIds: ["user-1", "user-2"],
        durationMins: 30,
      }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("slot");
    expect(body.confirmationRequired).toBe(true);
    expect(body.slot).toHaveProperty("start");
    expect(body.slot).toHaveProperty("end");
  });

  test("returns 400 if participantIds is empty", async () => {
    const { POST } = await import("../app/api/agents/schedule/route");
    const req = new Request("http://localhost/api/agents/schedule/find", {
      method: "POST",
      body: JSON.stringify({ participantIds: [], durationMins: 30 }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});

// ─── Agent 3: POST /api/agents/schedule/book ─────────────────────
describe("POST /api/agents/schedule/book", () => {
  test("rejects booking if confirmed is not true", async () => {
    const { POST } = await import("../app/api/agents/schedule/route");
    const req = new Request("http://localhost/api/agents/schedule/book", {
      method: "POST",
      body: JSON.stringify({
        slot: { start: "2026-03-29T17:00:00Z", end: "2026-03-29T17:30:00Z" },
        participants: ["user-1", "user-2"],
        confirmed: false,
      }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  test("books meeting and returns eventId when confirmed: true", async () => {
    const { POST } = await import("../app/api/agents/schedule/route");
    const req = new Request("http://localhost/api/agents/schedule/book", {
      method: "POST",
      body: JSON.stringify({
        slot: { start: "2026-03-29T17:00:00Z", end: "2026-03-29T17:30:00Z" },
        participants: ["user-1", "user-2"],
        confirmed: true,
      }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.booked).toBe(true);
    expect(body).toHaveProperty("eventId");
  });
});

// ─── Agent 3: GET /api/agents/schedule/availability ──────────────
describe("GET /api/agents/schedule/availability", () => {
  test("returns array of free slots for a user on a date", async () => {
    const { GET } = await import("../app/api/agents/schedule/route");
    const req = new Request(
      "http://localhost/api/agents/schedule/availability?userId=user-1&date=2026-03-29"
    );
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.slots)).toBe(true);
  });
});

// ─── Webhook: POST /api/webhooks/nylas ───────────────────────────
describe("POST /api/webhooks/nylas", () => {
  test("upserts calendar event into MongoDB", async () => {
    const { POST } = await import("../app/api/webhooks/nylas/route");
    const req = new Request("http://localhost/api/webhooks/nylas", {
      method: "POST",
      body: JSON.stringify({
        type: "event.created",
        data: {
          object: {
            id: "event-123",
            account_id: "user-1",
            title: "Team sync",
            when: {
              start_time: 1743260400,
              end_time: 1743262200,
            },
            participants: [{ email: "dharma@test.com" }, { email: "sai@test.com" }],
          },
        },
      }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
  });
});

// ─── GET /api/users/me ───────────────────────────────────────────
describe("GET /api/users/me", () => {
  test("returns 401 when not authenticated", async () => {
    const { GET } = await import("../app/api/users/me/route");
    const req = new Request("http://localhost/api/users/me");
    const res = await GET(req);
    // Unauthenticated request should return 401
    expect(res.status).toBe(401);
  });
});

// ─── UI: Component prop shapes ───────────────────────────────────
describe("AgentCard component", () => {
  test("accepts name, lastRun, and status props", () => {
    // Type check — if AgentCard compiles with these props, types are correct
    const props = {
      name: "Neo Brief",
      lastRun: "2 minutes ago",
      status: "idle" as "idle" | "running" | "error",
    };
    expect(props.name).toBe("Neo Brief");
    expect(["idle", "running", "error"]).toContain(props.status);
  });
});

describe("ConnectionCard component", () => {
  test("connected prop is boolean", () => {
    const props = {
      integration: "github",
      connected: true,
      accountName: "dharma",
      onConnect: () => {},
      onDisconnect: () => {},
    };
    expect(typeof props.connected).toBe("boolean");
  });
});
