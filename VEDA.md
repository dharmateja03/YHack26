# Veda — Work File

> Agent 4 (Root Cause) + Jira webhook + Embeddings + Data routes
> Files you own: lib/voyage.ts, app/api/agents/rootcause/route.ts, app/api/webhooks/jira/route.ts, app/api/data/prs/route.ts, app/api/data/tickets/route.ts

---

## Current State

All routes are **built and working**. Models now route through Lava as `gpt-5-chat-latest`.

### Completed
- [x] `lib/voyage.ts` — Voyage AI embedding client (voyage-code-2, 1536 dimensions)
  - `embed(text)` → single vector
  - `embedBatch(texts)` → batch vectors
  - Also powers conversational memory in `lib/memory.ts`
- [x] `app/api/agents/rootcause/route.ts` — Root cause via Atlas Vector Search
- [x] `app/api/webhooks/jira/route.ts` — Jira ticket ingestion with embeddings
- [x] `app/api/data/prs/route.ts` — PR list for dashboard
- [x] `app/api/data/tickets/route.ts` — Ticket list for dashboard

### How Hermes Changes Your Agents

Hermes is the new orchestrator brain. It routes requests to your root cause agent via `POST /api/agents/rootcause`. Your route handler doesn't need to change — Hermes calls it with structured payloads.

**Root cause agent:** Hermes delegates with `{ prId, ticketId }` via endpoint `rootcause`

When a user says "why is PR 42 blocked?" or "what's the root cause of JIRA-15?", Hermes extracts the PR/ticket ID from the message and delegates to your endpoint.

### Voyage AI is Now Used for Memory Too

Your `lib/voyage.ts` is imported by `lib/memory.ts` for conversational memory embeddings. Every chat turn gets embedded and stored in the `conversations` collection for semantic recall across sessions. This is the same `embed()` function — no changes needed on your side.

### Atlas Vector Search Indexes Needed

- `messages_vector` on `neosis.messages.embedding` — 1536 dims, cosine
- `prs_vector` on `neosis.prs.embedding` — 1536 dims, cosine
- `tickets_vector` on `neosis.tickets.embedding` — 1536 dims, cosine
- `conversations_vector` on `neosis.conversations.turns.embedding` — 1536 dims, cosine (NEW — for memory)

---

## Env vars you need
```
MONGODB_URI=
MONGODB_DB=neosis
LAVA_API_KEY=
LAVA_BASE_URL=https://api.lava.so/v1
VOYAGE_API_KEY=
```

---

## Coordinate with
- **Dharma** — `lib/mongodb.ts`, `lib/lava.ts`, `lib/hermes.ts` (orchestrator), `lib/memory.ts` (uses your voyage.ts)
- **Keshav** — calls `embed()` in the Slack webhook handler
- **Sai** — displays root cause results in AgentCard. Response shape: `{ cause, blockedBy, recommendedAction, evidence, confident }`
