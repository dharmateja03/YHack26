# Neosis — Full Architecture Document
> AI Executive Assistant for Engineering Teams
> Voice-first. Agent-to-agent. Built for the daily engineering workflow.

---

## Product Overview

Neosis is a voice-first AI executive assistant for engineering teams. It runs 7 autonomous agents orchestrated by **Hermes** — an LLM-powered brain that routes requests, gathers information through multi-turn conversation, and delegates to the right sub-agent. Agents communicate with each other to schedule meetings, negotiate via email, and resolve blockers. The product is accessible via web with full-duplex voice powered by ElevenLabs Conversational AI.

**Core philosophy:**
- Agent always asks clarifying questions before any irreversible action — never hallucinates
- Hermes orchestrator gathers at least 3 data points before delegating to any sub-agent
- Every answer cites its source (which PR, which Slack thread, which ticket)
- Each agent is OAuth-scoped — it only sees data it needs, nothing more
- Conversational memory across sessions via Voyage AI vector embeddings

---

## Name

**Neosis** (product name) / **Neo** (agent name users talk to) / **Hermes** (orchestrator brain)

---

## Tech Stack

| Layer | Tool | Why |
|---|---|---|
| Frontend | Next.js 14 (App Router) | Web first, deploy to Vercel in one command |
| UI | Tailwind CSS | Dark theme, premium look, no extra deps |
| Database | MongoDB Atlas | Memory, session state, agent logs, sprint data, negotiations |
| Vector search | MongoDB Atlas Vector Search | Same DB for RAG — no separate Pinecone needed |
| LLM routing | Lava Gateway (`api.lava.so/v1`) | Routes all LLM calls through one gateway, per-agent spend keys |
| Voice TTS | ElevenLabs (`eleven_turbo_v2`) | Streaming TTS, first word in 300ms, natural voice |
| Voice Duplex | ElevenLabs Conversational AI | Full-duplex WebRTC/WebSocket voice with agent ID |
| Orchestrator | Hermes (LLM-powered) | Intent routing, multi-turn gathering, agent delegation |
| Auth + OAuth | Auth0 AI | Stores GitHub/Slack/Jira/Calendar tokens per user securely |
| Embeddings | Voyage AI (`voyage-code-2`) | Conversational memory + semantic search across sessions |
| Calendar/Email | Nylas | Google + Outlook + Apple in one SDK for scheduling + email |
| Conversational Memory | 3-layer system | Short-term (session) + Long-term (vector) + Fallback (keyword) |
| Org Management | Built-in | Organizations, members, invites with MongoDB |

---

## LLM Model Routing via Lava

Every LLM call goes through Lava Gateway — never call models directly.
Base URL: `https://api.lava.so/v1`
Auth: `Authorization: Bearer $LAVA_API_KEY`
Agent tracking: pass `x-lava-agent-id` header on every call.

| Agent | x-lava-agent-id | Model | Purpose |
|---|---|---|---|
| Hermes (orchestrator) | `neo-hermes` | `gpt-5-chat-latest` | Intent routing, question gathering, delegation |
| Neo Chat (conversational) | `neo-chat` | `gpt-5-chat-latest` | General conversation, response synthesis |
| Neo Brief (morning/evening) | `neo-brief` | `gpt-5-chat-latest` | Daily briefing scripts |
| Neo PR (blocker hunter) | `neo-pr` | `gpt-5-chat-latest` | PR triage, reviewer routing |
| Neo Sched (meeting negotiator) | `neo-sched` | `gpt-5-chat-latest` | Calendar negotiation, slot finding |
| Neo Root (root cause) | `neo-root` | `gpt-5-chat-latest` | Root cause analysis over evidence |
| Neo Sprint (forecaster) | `neo-sprint` | `gpt-5-chat-latest` | Sprint forecast + release notes |
| Neo Sprint Notes | `neo-sprint-notes` | `gpt-5-chat-latest` | Release notes generation |

Each agent's token spend shows up separately in the Lava dashboard — proves unit economics.

---

## Hermes — The Orchestrator Brain

Hermes is the central intelligence that routes all user requests. It replaces keyword-based intent detection with LLM-powered understanding.

### How Hermes Works

1. **User speaks** → transcript goes to `POST /api/agents/chat`
2. **Hermes analyzes intent** — reads the message + full conversation history
3. **Three possible actions:**
   - `"ask"` — Hermes needs more info, returns a clarifying question
   - `"delegate"` — Hermes has enough info, routes to a sub-agent with structured payload
   - `"chat"` — General conversation, no sub-agent needed

### Multi-Turn Question Gathering

For scheduling (and other complex tasks), Hermes asks at least 3 questions before delegating:

```
User: "I need to meet with John"
Hermes: "What's the priority — urgent or can it wait?"     → action: "ask"
User: "P1, urgent"
Hermes: "What should we title this meeting?"                → action: "ask"
User: "Sprint planning sync"
Hermes: "Any time preference, or first available?"          → action: "ask"
User: "Tomorrow afternoon"
Hermes: delegates to neo-sched with full payload            → action: "delegate"
```

Hermes progressively accumulates extracted data in the `extracted` field across turns. The conversation history IS the state — no separate state machine needed for gathering.

### Email Scheduling Negotiation

After neo-sched books a slot, the system automatically:
1. Creates a **negotiation record** (state: `proposed`)
2. Sends a **proposal email** to the participant via Nylas
3. When the participant **replies**, the mail route:
   - Detects if the reply is agreement, counter-proposal, or rejection
   - Agreement → auto-books the meeting
   - Counter-proposal → finds new slot, sends counter email
   - Rejection → marks negotiation as failed
4. The negotiation state machine: `proposed → awaiting_reply → (counter ↔ awaiting_reply) → agreed → booked`

### Files

- `lib/hermes.ts` — Orchestrator with `analyzeIntent()` function
- `lib/negotiate.ts` — Email negotiation state machine + Nylas email sending
- `app/api/agents/chat/route.ts` — Main endpoint using Hermes

---

## Conversational Memory System

Three-layer graceful degradation for remembering past conversations:

### Layer 1: Short-Term (Session Turns)
- Recent 8 turns from the current session stored in MongoDB `conversations` collection
- Provides immediate conversational context

### Layer 2: Long-Term (Voyage AI Vector Search)
- Every turn gets embedded via Voyage AI (`voyage-code-2`, 1536 dimensions)
- Atlas Vector Search finds semantically relevant turns from ALL past sessions
- Threshold: similarity >= 0.65

### Layer 3: Fallback (Keyword Search)
- If vector search is unavailable, falls back to MongoDB text search
- If MongoDB is unavailable, falls back to in-memory keyword matching

### Files
- `lib/memory.ts` — `saveTurn()`, `getRecentTurns()`, `recallRelevantMemory()`, `buildConversationContext()`
- `lib/voyage.ts` — `embed()` and `embedBatch()` using Voyage AI

---

## MongoDB Collections

All data lives in MongoDB Atlas. Atlas Vector Search replaces Pinecone.

### `neosis.prs`
GitHub pull requests synced via webhook.
Fields: prId, title, body, author, assignee, reviewers, approvals, requiredApprovals, files, state, checks, mergeable, ticketId, teamId, createdAt, updatedAt

### `neosis.tickets`
Jira / Linear tickets.
Fields: ticketId, title, description, status, priority, assignee, reporter, sprintId, teamId, blockedBy, createdAt, updatedAt

### `neosis.messages`
Slack messages and threads.
Fields: messageId, channelId, author, text, mentions, threadId, teamId, embedding, createdAt

### `neosis.calendars`
Calendar events per user (synced via Nylas).
Fields: eventId, userId, title, start, end, attendees, attendeeEmails, threadId, threadText, autoReschedule, meetingPriority, ownerUserId, orgId, createdAt

### `neosis.briefs`
Morning and evening briefs.
Fields: userId, type, script, context, createdAt

### `neosis.sprints`
Sprint data and forecasts.
Fields: sprintId, teamId, name, startDate, endDate, stories, velocity, forecast, createdAt

### `neosis.agents`
Agent run logs.
Fields: agent, action, input, output, userId, teamId, durationMs, createdAt

### `neosis.preferences`
Per-user agent preferences.
Fields: userId, name, team, timezone, noMeetingsBefore, noMeetingsAfter, deepWorkDays, slackUserId, githubUsername, createdAt

### `neosis.conversations`
Conversational memory — turns with vector embeddings.
Fields: sessionId, userId, turns (array of {role, content, agentUsed, embedding, timestamp}), createdAt, updatedAt

### `neosis.emails`
Ingested email messages.
Fields: messageId, threadId, fromEmail, toEmails, subject, text, orgId, receivedAt, createdAt

### `neosis.organizations`
Organization records.
Fields: orgId, name, slug, createdBy, createdAt

### `neosis.org_members`
Organization membership.
Fields: orgId, userId, name, email, workEmail, role (manager/member), joinedAt

### `neosis.org_invites`
Organization invite tokens.
Fields: token, orgId, createdBy, role, createdAt, expiresAt, maxUses, uses

### `neosis.negotiations`
Email scheduling negotiation state.
Fields: negotiationId, threadId, sessionId, requesterUserId, requesterEmail, participantUserId, participantEmail, participantName, title, priority, durationMins, state, proposedSlot, alternatives, counterSlot, requesterConfidence, participantConfidence, emailThread, eventId, createdAt, updatedAt

---

## The Agents

### Agent 0: Hermes (Orchestrator)
**What it does:** Analyzes every user message, determines intent via LLM, gathers required info through natural multi-turn conversation, then delegates to the right sub-agent with a structured payload. Replaces keyword-based routing with intelligent understanding.

**Model:** `gpt-5-chat-latest` via Lava (agent-id: `neo-hermes`)
**Temperature:** 0.12 (deterministic routing)
**Entry point:** `lib/hermes.ts` → `analyzeIntent()`

### Agent 1: Neo Brief (morning + evening narrator)
**What it does:** Generates spoken daily briefings. Reads open PRs, tickets, mentions, calendar from MongoDB. Produces a 90-second spoken narrative via ElevenLabs.

**Model:** `gpt-5-chat-latest` via Lava (agent-id: `neo-brief`)
**Voice:** ElevenLabs `eleven_turbo_v2` streaming
**Route:** `POST /api/agents/brief`

### Agent 2: Neo PR (blocker hunter + review router)
**What it does:** Watches GitHub PRs. Detects stale PRs (12h+ unreviewed), routes reviewers based on git history, runs merge readiness checks, sends Slack nudges.

**Model:** `gpt-5-chat-latest` via Lava (agent-id: `neo-pr`)
**Routes:** `GET/POST /api/agents/pr` with `?action=scan`

### Agent 3: Neo Sched (meeting negotiator)
**What it does:** Finds mutual free slots across calendars, books meetings, handles reschedules. Now integrated with email negotiation — proposes times to participants via email, handles counter-proposals, auto-books when agreed.

**Model:** `gpt-5-chat-latest` via Lava (agent-id: `neo-sched`)
**Routes:** `POST /api/agents/schedule` with `?action=find|book|cancel|reschedule|reconcile|orchestrate`

### Agent 4: Neo Root (root cause detective)
**What it does:** Given a delayed PR or ticket, traces through Slack, Jira, GitHub using Atlas Vector Search. Returns the actual human reason for the delay with evidence and citations.

**Model:** `gpt-5-chat-latest` via Lava (agent-id: `neo-root`)
**Route:** `POST /api/agents/rootcause`

### Agent 5: Neo Sprint (forecaster + release narrator)
**What it does:** Reads sprint velocity, open PRs, blockers. Forecasts sprint risk. Generates release notes and retro drafts.

**Model:** `gpt-5-chat-latest` via Lava (agent-id: `neo-sprint`)
**Routes:** `POST /api/agents/sprint` with `?action=forecast|release-notes|retro`

### Agent 6: Neo Mail (email processor)
**What it does:** Ingests emails, summarizes inbox, detects reschedule intent, processes negotiation replies. When an email is part of an active scheduling negotiation, it analyzes the reply and either books the meeting (agreement), sends a counter-proposal, or marks as failed.

**Model:** `gpt-5-chat-latest` via Lava (agent-id: `neo-chat`)
**Route:** `POST /api/agents/mail` with `?action=ingest|summarize`

---

## Voice Architecture

### ElevenLabs Conversational AI (Full-Duplex)
- Agent ID: `agent_2101kmw3enfdfh1bpyyrynh831x2`
- Full-duplex voice via WebRTC/WebSocket using `@elevenlabs/react` `useConversation` hook
- Signed URL auth via `/api/elevenlabs/signed-url`
- Real-time transcript callbacks stream into chat UI

### ElevenLabs TTS (One-Way Streaming)
- Model: `eleven_turbo_v2`
- Voice settings: stability 0.38, similarity_boost 0.82, style 0.28
- Streams `audio/mpeg` chunks — first word in ~300ms
- Used when `Accept: audio/mpeg` header is sent to agent endpoints

### Voice Input
- Browser Web Speech API for speech-to-text
- Transcript sent to `POST /api/agents/chat` which routes through Hermes

---

## Organization System

Users can create organizations and invite team members:
- `POST /api/orgs/setup` — create org with manager role
- `POST /api/orgs/invites` — generate invite token
- `POST /api/orgs/invites/redeem` — join org via token
- `GET /api/orgs/me` — get org context for current user

The org system powers participant resolution in scheduling — when a user says "meet with John", the system looks up John in the org's member list and resolves their email/userId.

**Files:** `lib/org.ts`, `app/api/orgs/*/route.ts`

---

## Auth Architecture (Auth0 AI)

Auth0 handles user login and OAuth token storage per user.

**User login:** Auth0 Next.js SDK with Google and GitHub login.
**OAuth token vault:** `lib/auth0.ts` provides `getTokenForUser(userId, integration)` and `saveToken()`.
**Routes:** `app/api/auth/[...auth0]/route.ts`

---

## API Routes — Complete List

### Main Chat Endpoint
- POST /api/agents/chat — main conversational endpoint (Hermes orchestrator)
- GET /api/agents/chat?sessionId=xxx — conversation history

### Agent Routes
- POST /api/agents/brief — generate morning or evening brief
- GET/POST /api/agents/pr — PR triage with ?action=scan
- POST /api/agents/schedule — scheduling with ?action=find|book|cancel|reschedule|reconcile|orchestrate
- GET /api/agents/schedule/availability?userId=xxx&date=xxx — free slots
- POST /api/agents/rootcause — root cause analysis
- POST /api/agents/sprint — sprint with ?action=forecast|release-notes|retro
- GET /api/agents/sprint?teamId=xxx — sprint dashboard data
- POST /api/agents/mail — email with ?action=ingest|summarize

### Org Routes
- POST /api/orgs/setup — create organization
- GET /api/orgs/me — org context
- POST /api/orgs/invites — create invite
- POST /api/orgs/invites/redeem — join org
- GET/POST /api/orgs/profile — member profile

### Webhook Routes
- POST /api/webhooks/github — GitHub PR events
- POST /api/webhooks/slack — Slack message events
- POST /api/webhooks/jira — Jira issue events
- POST /api/webhooks/nylas — Calendar events

### Auth Routes
- GET /api/auth/login, /api/auth/callback, /api/auth/logout
- GET /api/users/me — current user profile
- POST /api/users/keys — manage API keys

### Data Routes
- GET /api/data/prs?teamId=xxx
- GET /api/data/tickets?teamId=xxx
- GET /api/data/sprint?teamId=xxx

### Voice
- GET /api/elevenlabs/signed-url — signed WebSocket URL for Conversational AI

---

## Folder Structure

```
neosis/
├── app/
│   ├── page.tsx                    — Main dashboard: Talk to Neo orb + agent cards
│   ├── settings/page.tsx           — Connections: GitHub/Slack/Jira/Calendar
│   ├── layout.tsx                  — Root layout with dark theme
│   ├── globals.css                 — Animations: orb-breathe, typing-cursor, agent-glow
│   ├── join/[token]/page.tsx       — Org invite redemption page
│   ├── api/
│   │   ├── agents/
│   │   │   ├── chat/route.ts       — Main chat endpoint (Hermes orchestrator)
│   │   │   ├── brief/route.ts      — Agent 1: morning/evening brief + voice
│   │   │   ├── pr/route.ts         — Agent 2: PR blocker scan + routing
│   │   │   ├── schedule/route.ts   — Agent 3: meeting negotiator + Nylas
│   │   │   ├── rootcause/route.ts  — Agent 4: root cause via vector search
│   │   │   ├── sprint/route.ts     — Agent 5: sprint forecast + release notes
│   │   │   └── mail/route.ts       — Agent 6: email ingest + negotiation
│   │   ├── webhooks/
│   │   │   ├── github/route.ts     — GitHub PR events
│   │   │   ├── slack/route.ts      — Slack message events
│   │   │   ├── jira/route.ts       — Jira ticket events
│   │   │   └── nylas/route.ts      — Calendar events
│   │   ├── auth/[...auth0]/route.ts
│   │   ├── elevenlabs/signed-url/route.ts
│   │   ├── orgs/
│   │   │   ├── setup/route.ts
│   │   │   ├── me/route.ts
│   │   │   ├── invites/route.ts
│   │   │   ├── invites/redeem/route.ts
│   │   │   └── profile/route.ts
│   │   ├── users/
│   │   │   ├── me/route.ts
│   │   │   └── keys/route.ts
│   │   ├── data/
│   │   │   ├── prs/route.ts
│   │   │   ├── tickets/route.ts
│   │   │   └── sprint/route.ts
│   │   └── demo/slack/route.ts
├── lib/
│   ├── mongodb.ts                  — MongoDB client + 14 collection constants
│   ├── lava.ts                     — Lava gateway client + 8-agent model routing
│   ├── hermes.ts                   — Hermes orchestrator: analyzeIntent()
│   ├── negotiate.ts                — Email negotiation state machine
│   ├── memory.ts                   — 3-layer conversational memory system
│   ├── elevenlabs.ts               — ElevenLabs TTS streaming
│   ├── voyage.ts                   — Voyage AI embeddings (1536-dim)
│   ├── auth0.ts                    — Auth0 AI token vault
│   └── org.ts                      — Organization management
├── components/
│   ├── AgentCard.tsx               — Agent status card with glow animation
│   ├── VoicePlayer.tsx             — Audio player bar
│   └── ConnectionCard.tsx          — OAuth connect/disconnect card
├── scripts/
│   └── seed.ts                     — Seed MongoDB with mock data
└── __tests__/
    └── dharma.test.ts              — Integration tests
```

---

## Environment Variables

```
# LLM Gateway
LAVA_API_KEY=aks_live_...
LAVA_BASE_URL=https://api.lava.so/v1

# Hermes Orchestrator
HERMES_ENABLED=true
HERMES_TRANSPORT=lava
HERMES_LAVA_MODEL=gpt-5-chat-latest
HERMES_LAVA_AGENT_ID=neo-sched-hermes
HERMES_TIMEOUT_MS=20000

# Voice
ELEVENLABS_API_KEY=sk_...
ELEVENLABS_CONVAI_AGENT_ID=agent_2101kmw3enfdfh1bpyyrynh831x2
NEXT_PUBLIC_ELEVENLABS_AGENT_ID=agent_2101kmw3enfdfh1bpyyrynh831x2

# Auth
AUTH0_CLIENT_ID=...
AUTH0_CLIENT_SECRET=...
AUTH0_ISSUER_BASE_URL=https://dev-....auth0.com/
AUTH0_BASE_URL=http://localhost:3000/
AUTH0_SECRET=...

# Integrations
SLACK_BOT_TOKEN=xoxb-...
NYLAS_API_KEY=nyk_v0_...

# Database
MONGODB_URI=mongodb+srv://...
MONGODB_DB=neosis

# Identity
NEO_AGENT_EMAIL=neo-agent@neosis.ai
MASTER_USER_ID=user-1
MASTER_USER_NAME=Dharma
MASTER_USER_EMAIL=dharma@neosis.ai
```

---

## Key Design Decisions

1. **Hermes as LLM router** — Instead of keyword matching (`if text.includes("schedule")`), Hermes uses an LLM to understand intent. This handles ambiguous requests, follow-ups, and context from prior conversation.

2. **Conversation history as state** — No separate state machine for multi-turn gathering. The conversation history stored in MongoDB IS the state. Hermes reads it on every turn to determine what's been answered.

3. **Email negotiation is agent-to-agent** — When scheduling involves someone outside the current session, Neo's agent emails their agent (or them directly). The mail route processes replies and updates negotiation state automatically.

4. **3-layer memory degradation** — Vector search → MongoDB text → in-memory keyword. The system works at every level of infrastructure availability.

5. **All models through Lava** — Single API key, per-agent spend tracking, model routing in one place. Currently all agents use `gpt-5-chat-latest`.

6. **Voice-first design** — Every agent response is optimized for spoken output: 2-3 sentences max, no markdown, no bullet lists. `toSpokenStyle()` strips formatting before TTS.
