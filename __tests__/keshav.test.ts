// Keshav — Tests for: lib/elevenlabs.ts, Agent 1 (Brief), Agent 5 (Sprint), Slack webhook
// Run: npx jest __tests__/keshav.test.ts

// ─── lib/elevenlabs.ts ───────────────────────────────────────────
describe("lib/elevenlabs", () => {
  test("streamSpeech is exported and callable", async () => {
    const { streamSpeech } = await import("../lib/elevenlabs");
    expect(typeof streamSpeech).toBe("function");
  });

  test("streamSpeech returns a ReadableStream", async () => {
    const { streamSpeech } = await import("../lib/elevenlabs");
    // Only run if ELEVENLABS_API_KEY is set
    if (!process.env.ELEVENLABS_API_KEY) {
      console.warn("Skipping ElevenLabs test — no API key");
      return;
    }
    const stream = await streamSpeech("Hello, this is a test.");
    expect(stream).toBeInstanceOf(ReadableStream);
  });
});

// ─── Agent 1: POST /api/agents/brief (JSON) ──────────────────────
describe("POST /api/agents/brief — JSON response", () => {
  test("returns a script string for morning brief", async () => {
    const { POST } = await import("../app/api/agents/brief/route");
    const req = new Request("http://localhost/api/agents/brief", {
      method: "POST",
      body: JSON.stringify({ userId: "user-1", type: "morning" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.script).toBe("string");
    expect(body.script.length).toBeGreaterThan(10);
  });

  test("returns a script string for evening brief", async () => {
    const { POST } = await import("../app/api/agents/brief/route");
    const req = new Request("http://localhost/api/agents/brief", {
      method: "POST",
      body: JSON.stringify({ userId: "user-1", type: "evening" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.script).toBe("string");
  });

  test("rejects missing userId", async () => {
    const { POST } = await import("../app/api/agents/brief/route");
    const req = new Request("http://localhost/api/agents/brief", {
      method: "POST",
      body: JSON.stringify({ type: "morning" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});

// ─── Agent 1: GET /api/agents/brief ──────────────────────────────
describe("GET /api/agents/brief", () => {
  test("returns last 5 briefs for a user", async () => {
    const { GET } = await import("../app/api/agents/brief/route");
    const req = new Request("http://localhost/api/agents/brief?userId=user-1");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.briefs)).toBe(true);
    expect(body.briefs.length).toBeLessThanOrEqual(5);
  });
});

// ─── Agent 5: POST /api/agents/sprint/forecast ───────────────────
describe("POST /api/agents/sprint/forecast", () => {
  test("returns forecast with onTrack boolean and recommendation", async () => {
    const { POST } = await import("../app/api/agents/sprint/route");
    const req = new Request("http://localhost/api/agents/sprint/forecast", {
      method: "POST",
      body: JSON.stringify({ teamId: "team-1" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.onTrack).toBe("boolean");
    expect(typeof body.recommendation).toBe("string");
    expect(typeof body.bottleneck).toBe("string");
  });
});

// ─── Agent 5: POST /api/agents/sprint/release-notes ──────────────
describe("POST /api/agents/sprint/release-notes", () => {
  test("returns internal and external versions", async () => {
    const { POST } = await import("../app/api/agents/sprint/route");
    const req = new Request("http://localhost/api/agents/sprint/release-notes", {
      method: "POST",
      body: JSON.stringify({ teamId: "team-1", sprintId: "sprint-1" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.internal).toBe("string");
    expect(typeof body.external).toBe("string");
  });
});

// ─── Webhook: POST /api/webhooks/slack ───────────────────────────
describe("POST /api/webhooks/slack", () => {
  test("handles Slack URL verification challenge", async () => {
    const { POST } = await import("../app/api/webhooks/slack/route");
    const req = new Request("http://localhost/api/webhooks/slack", {
      method: "POST",
      body: JSON.stringify({ type: "url_verification", challenge: "abc123" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.challenge).toBe("abc123");
  });

  test("upserts message into MongoDB on message event", async () => {
    const { POST } = await import("../app/api/webhooks/slack/route");
    const req = new Request("http://localhost/api/webhooks/slack", {
      method: "POST",
      body: JSON.stringify({
        type: "event_callback",
        event: {
          type: "message",
          ts: "1234567890.000001",
          channel: "C123",
          user: "U456",
          text: "hey can someone review PR #42?",
        },
      }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
  });
});
