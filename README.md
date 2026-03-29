# Neosis

**The Affordable AI Executive Assistant for Engineering Teams**

Neosis is a voice-first, multi-agent system that helps engineering teams manage their daily workflow — PRs, tickets, sprints, scheduling, and briefings — through natural conversation with **Neo**, an AI assistant that remembers context across sessions.

Built at YHack 2026 by Dharma, Keshav, Veda, and Sai.

---

## What Neo Can Do

| Capability | Example prompts |
|-----------|-----------------|
| **Morning briefing** | "Give me my morning briefing" |
| **PR triage** | "Show me the open PRs", "Which PRs are ready to merge?" |
| **Sprint status** | "How's the current sprint looking?" |
| **Meeting scheduling** | "Schedule a sync with Keshav tomorrow at 10am" |
| **Team assignments** | "What is Sai working on?", "What tickets are assigned to me?" |
| **Blocker analysis** | "Are there any blockers right now?", "What's blocking tk-002?" |
| **Email summary** | "Summarize my inbox" |
| **General chat** | "Hello", "Who has capacity this week?" |

All prompts work via text or voice (ElevenLabs Conversational AI).

---

## Architecture

```
Browser (voice / text)
    │
    ▼
┌───────────────────────────────────────────────┐
│  Next.js 14 (App Router)                      │
│                                               │
│  /api/agents/chat  ← main endpoint            │
│      │                                        │
│      ├── deterministic intent router           │
│      │   (regex-based, zero-latency)           │
│      ├── memory recall (short + long term)     │
│      ├── live context (PRs, tickets, sprint)   │
│      ├── sub-agent delegation                  │
│      └── LLM response generation               │
│                                               │
│  Sub-agents:                                  │
│  /api/agents/brief    → daily briefings       │
│  /api/agents/pr       → PR triage & review    │
│  /api/agents/schedule → meeting booking       │
│  /api/agents/sprint   → forecast & velocity   │
│  /api/agents/mail     → email summary         │
└──────┬──────────┬──────────┬──────────────────┘
       │          │          │
       ▼          ▼          ▼
   Lava.so     SQLite     Nylas      ElevenLabs
   (LLM)     (storage)  (calendar)    (voice)
```

## How It Works

### Intent Routing (Hermes)

Neo uses a **deterministic rule-based intent router** — no LLM in the routing loop. Simple regex patterns match user messages to the right sub-agent:

- `schedule`, `book`, `meeting with` → **neo-sched** (meeting scheduling via Nylas)
- `pr`, `pull request`, `code review` → **neo-pr** (PR triage)
- `sprint`, `velocity`, `forecast` → **neo-sprint** (sprint forecasting)
- `briefing`, `catch me up` → **neo-brief** (daily briefings)
- `email`, `inbox` → **neo-mail** (email summary)
- Everything else → **neo-chat** (general conversation with full live context)

This is fast, predictable, and avoids the hallucination issues of LLM-based classification.

### Conversation Memory

Unlike typical one-shot AI chat, Neosis maintains **multi-turn conversational memory**:

1. **Short-term** — Last 8 turns from the current session
2. **Long-term** — Voyage AI embeddings + vector search across all past sessions. If you discussed PR-42 last week and ask "what happened with that stuck PR?" today, Neo finds it.
3. **Graceful degradation** — No Voyage API? Keyword search. No vector DB? In-memory store.

### Live Context

Every message gets enriched with real-time team data from SQLite:
- Open PRs with author, assignee, check status, approval counts
- Tickets with priority, status, assignee, blockers
- Sprint progress with velocity and story completion
- Org roster with team member details

### Meeting Scheduling (Nylas)

The schedule agent books real calendar invites:
1. Deterministic router detects scheduling intent and extracts participants, time, duration
2. Participant names are resolved against the org roster
3. Calendar availability is checked via Nylas API
4. Meeting is booked and invites sent to all participants' emails

### Voice

Neo uses **ElevenLabs Conversational AI** for full-duplex, real-time voice:

```
User clicks mic → browser requests permission
  → signed WebSocket URL from server
  → bidirectional audio stream:
     User speaks → STT → agent processes → TTS → user hears Neo
```

| Mode | Tech | Latency | Experience |
|------|------|---------|------------|
| Live duplex (primary) | ElevenLabs Conv. AI | ~500ms e2e | Natural conversation, interruptions |
| Streaming TTS | ElevenLabs Turbo v2 | ~300ms first word | Text-triggered speech |
| Browser fallback | Web Speech API | Instant | Offline, robotic |

## Tech Stack

| Layer | Tech |
|-------|------|
| Framework | Next.js 14 (App Router) |
| Styling | Tailwind CSS |
| Auth | Auth0 |
| Database | SQLite (dual: relational tables + JSON docs) |
| Embeddings | Voyage AI (`voyage-code-2`, 1536-dim) |
| LLM Gateway | Lava.so (routes to Claude, Groq, Llama) |
| Calendar | Nylas API |
| Voice (live) | ElevenLabs Conversational AI (WebRTC/WS) |
| Voice (TTS) | ElevenLabs Turbo v2 (streaming) |
| STT | ElevenLabs (live) / Web Speech API (fallback) |

### LLM Routing via Lava.so

| Agent | Model | Why |
|-------|-------|-----|
| `neo-brief` | `claude-haiku-4-5` | Fast, cheap — daily summaries |
| `neo-pr` | `groq/llama-3.1-70b` | Fast inference for PR scanning |
| `neo-sched` | `claude-sonnet-4-6` | Complex reasoning for scheduling |
| `neo-root` | `claude-sonnet-4-6` | Deep analysis for root cause |
| `neo-sprint` | `claude-sonnet-4-6` | Forecasting needs strong reasoning |
| `neo-chat` | default | General conversation |

## Environment Variables

```env
# Lava.so (LLM gateway)
LAVA_API_KEY=lava-...
LAVA_BASE_URL=https://api.lava.so/v1

# ElevenLabs (voice)
ELEVENLABS_API_KEY=xi-...
ELEVENLABS_VOICE_ID=...
ELEVENLABS_CONVAI_AGENT_ID=...
NEXT_PUBLIC_ELEVENLABS_AGENT_ID=...

# Voyage AI (embeddings)
VOYAGE_API_KEY=voyage-...

# Auth0
AUTH0_SECRET=...
AUTH0_BASE_URL=http://localhost:3000
AUTH0_ISSUER_BASE_URL=https://your-tenant.auth0.com
AUTH0_CLIENT_ID=...
AUTH0_CLIENT_SECRET=...

# Nylas (calendar)
NYLAS_API_KEY=...
NYLAS_GRANT_ID=...

# Master user (dev/demo mode)
MASTER_USER_ID=ds3519
ENABLE_MASTER_FALLBACK=true
```

## Getting Started

```bash
# Install dependencies
npm install

# Seed the database with sample data
npm run seed

# Seed randomized demo PRs/issues/messages
npm run seed:demo -- --prs 20 --tickets 12 --messages 30

# Run dev server
npm run dev
```

## Project Structure

```
app/
  neo/page.tsx              → Chat UI (text + voice)
  page.tsx                  → Landing page
  api/agents/
    chat/route.ts           → Main conversational endpoint
    brief/route.ts          → Daily briefing agent
    pr/route.ts             → PR triage agent
    schedule/route.ts       → Meeting scheduling agent
    sprint/route.ts         → Sprint forecasting agent
    mail/route.ts           → Email summary agent

lib/
  hermes.ts                 → Deterministic intent router
  lava.ts                   → LLM gateway (Lava.so)
  memory.ts                 → Short/long-term conversation memory
  sqlite.ts                 → SQLite database + schema
  mongodb.ts                → MongoDB-like adapter over SQLite
  org.ts                    → Org roster + member resolution
  nylas.ts                  → Nylas calendar API
  elevenlabs.ts             → ElevenLabs TTS streaming
  voyage.ts                 → Voyage AI embeddings
```

## Team

| Member | Focus Areas |
|--------|------------|
| **Dharma** | Chat endpoint, intent routing, memory system, architecture |
| **Keshav** | Sprint agent, ElevenLabs TTS, brief agent |
| **Veda** | Root cause agent, Voyage embeddings, vector search |
| **Sai** | Schedule agent, UI/frontend, Nylas integration |
