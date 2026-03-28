# Neosis — Full Architecture Document
> AI Executive Assistant for Engineering Teams
> Voice-first. Agent-to-agent. Built for the daily engineering workflow.
> Use this doc with Claude Code to build the full system.

---

## Product Overview

Neosis is a voice-first AI executive assistant for engineering teams. It runs 5 autonomous agents that watch GitHub, Slack, Jira, Gmail, and Calendar — and act without being asked. Every engineer on the team gets their own agent. Agents communicate with each other to schedule meetings. The product is accessible via web (first) then mobile.

**Core philosophy:**
- Agent always asks "say okay" before any irreversible action (send message, book meeting, close ticket)
- If agent is not 100% confident, it asks a clarifying question — never hallucinates
- Every answer cites its source (which PR, which Slack thread, which ticket)
- Each agent is OAuth-scoped — it only sees data it needs, nothing more

---

## Name

**Neosis** (product name) / **Neo** (agent name users talk to)

---

## Tech Stack

| Layer | Tool | Why |
|---|---|---|
| Frontend | Next.js 14 (App Router) | Web first, deploy to Vercel in one command |
| UI | Tailwind + shadcn/ui | Simple: one main agent button + settings page |
| Database | MongoDB Atlas | Memory, session state, agent logs, sprint data |
| Vector search | MongoDB Atlas Vector Search | Same DB for RAG — no separate Pinecone needed |
| LLM routing | Lava Gateway (`gateway.lava.so/v1`) | Routes Claude/Groq per agent, per-agent spend keys, usage metering |
| Voice TTS | ElevenLabs (`eleven_turbo_v2`) | Streaming TTS, first word in 300ms, natural voice |
| Auth + OAuth vault | Auth0 AI | Stores GitHub/Slack/Jira/Calendar tokens per user securely |
| Embeddings | Voyage AI | Better than OpenAI for mixed code + text content |
| Background jobs | Inngest | Webhook ingestion, scheduled briefs, retry logic |
| Calendar/Email API | Nylas | Google + Outlook + Apple in one SDK for scheduling agent |
| Billing | Lava Monetize | Per-agent spend tracking, usage metering |
| Deployment | Vercel (frontend) + Railway (backend) | Zero DevOps |

---

## LLM Model Routing via Lava

Every LLM call goes through Lava Gateway — never call Claude or Groq directly.
Base URL: `https://gateway.lava.so/v1`
Auth: `Authorization: Bearer $LAVA_API_KEY`
Agent tracking: pass `x-lava-agent-id` header on every call.

| Agent | Model ID | Why |
|---|---|---|
| Neo Brief (morning/evening script) | `claude-haiku-4-5-20251001` | Fast + cheap, 300 tokens max |
| Neo PR (nudge messages, routing) | `groq/llama-3.1-70b-versatile` | Simple generation, 10x cheaper than Claude |
| Neo Sched (slot negotiation) | `claude-sonnet-4-6` | Multi-step reasoning over calendars |
| Neo Root (root cause analysis) | `claude-sonnet-4-6` | Deep reasoning over retrieved evidence |
| Neo Sprint — forecast | `claude-sonnet-4-6` | Weighing velocity + blocker signals |
| Neo Sprint — release notes | `groq/llama-3.1-70b-versatile` | Structured templated output, fast |

**x-lava-agent-id values:** `neo-brief`, `neo-pr`, `neo-sched`, `neo-root`, `neo-sprint`
Each agent's token spend shows up separately in the Lava dashboard — proves unit economics to judges.

---

## MongoDB Collections

All data lives in MongoDB Atlas. Atlas Vector Search replaces Pinecone.

### `neosis.prs`
Stores GitHub pull requests synced via webhook.
Fields: prId, title, body, author, assignee, reviewers, approvals, requiredApprovals, files (array of file paths), state (open/merged/closed), checks (ci status), mergeable, ticketId, teamId, createdAt, updatedAt

### `neosis.tickets`
Stores Jira / Linear tickets.
Fields: ticketId, title, description, status, priority, assignee, reporter, sprintId, teamId, blockedBy (array), createdAt, updatedAt

### `neosis.messages`
Stores Slack messages and threads.
Fields: messageId, channelId, author, text, mentions (array of userIds), threadId, teamId, createdAt
Indexed with Atlas Vector Search on `text` field using Voyage AI embeddings.

### `neosis.calendars`
Stores calendar events per user (synced via Nylas).
Fields: eventId, userId, title, start, end, attendees, location, description, createdAt

### `neosis.briefs`
Stores every morning and evening brief generated.
Fields: userId, type (morning/evening), script (the spoken text), context snapshot, createdAt

### `neosis.sprints`
Stores sprint data and forecasts.
Fields: sprintId, teamId, name, startDate, endDate, stories (array), velocity, forecast (object), createdAt

### `neosis.agents`
Agent run logs — every time an agent runs, log it here.
Fields: agent (which agent), action (what it did), input, output, userId, teamId, durationMs, createdAt

### `neosis.preferences`
Per-user agent preferences.
Fields: userId, name, team, timezone, noMeetingsBefore (hour), noMeetingsAfter (hour), deepWorkDays (array), slackUserId, githubUsername, createdAt

---

## The 5 Agents

### Agent 1: Neo Brief (morning + evening narrator)

**What it does:** Runs on a schedule — 7am and 6pm per user timezone. Reads their open PRs, Jira tickets, Slack mentions, and calendar from MongoDB. Claude writes a 90-second spoken narrative. ElevenLabs converts to audio and streams it.

**Morning brief covers:**
- How many meetings today and when the first one is
- How many PRs need their review and which one is most urgent
- Any P1 or P2 tickets opened overnight
- What teammates are blocked on that they can unblock
- Their one clear priority for today

**Evening wrap covers:**
- What the team shipped today (merged PRs, closed tickets)
- What's still open and at risk
- Any new issues filed that need attention tomorrow
- Sprint health update
- What tomorrow looks like (meetings, PRs due)

**Model:** Claude Haiku 4.5 via Lava (fast + cheap, 300 tokens max)
**Voice:** ElevenLabs eleven_turbo_v2 streaming
**MongoDB reads:** prs, tickets, messages, calendars
**MongoDB writes:** briefs collection (stores every brief for history)
**Trigger:** Inngest cron job at 7am and 6pm per user timezone

**API routes:**
- POST /api/agents/brief — generate brief, returns JSON or streams audio if Accept: audio/mpeg
- GET /api/agents/brief?userId=xxx — returns last 5 briefs

---

### Agent 2: Neo PR (blocker hunter + review router)

**What it does:** Watches GitHub via webhook. When a PR sits unreviewed for 12+ hours, agent fires. Finds who has the most git history context on those files. Checks their calendar (are they in meetings all day?). Sends a friendly Slack nudge. Shows the EM a real-time blocker dashboard.

**Features:**
- Stale PR detection: any PR unreviewed for 12h+ is flagged
- Smart reviewer routing: finds who touched those files most recently in git history, not just who's on the default team
- Merge readiness check: before any merge — tests green? all approvals? no conflicts? linked to ticket? rollback plan exists?
- PR conflict warning: two open PRs touching the same files? Flag before either merges
- Slack nudge: sends a one-sentence friendly message to the right reviewer, only after user confirms ("say okay")
- PR summary to Slack: when a PR merges, auto-posts plain English summary to the right channel

**Model:** Groq Llama 3.1 70B via Lava (simple generation, fast, cheap)
**MongoDB reads:** prs collection, checks file overlap
**MongoDB writes:** agents collection (logs every scan + nudge)
**Trigger:** GitHub webhook on PR open/update + Inngest job every hour for stale scan

**API routes:**
- GET /api/agents/pr?teamId=xxx — all open PRs with blocker status + wait hours
- POST /api/agents/pr/scan — scan all open PRs for blockers, return analysis
- POST /api/agents/pr/route — given a prId, suggest best reviewer based on git history
- POST /api/agents/pr/nudge — send Slack nudge to reviewer (requires user confirmation)
- POST /api/agents/pr/merge-check — run merge readiness checklist for a PR

---

### Agent 3: Neo Sched (meeting negotiator)

**What it does:** User says "meet with Sarah at 3pm." Agent checks Sarah's calendar via Nylas (Auth0 stores her OAuth token). Busy at 3pm? Agent tries 4pm. Checks user's calendar at 4pm. Both free? Books it, sends invite to both, notifies both on Slack. Neither human does anything after the first sentence.

**For multi-person:** "Schedule backend sync with the whole team this week" — agent checks all 6 calendars, finds first 30-minute window all are free, books it, notifies everyone.

**Preferences respected automatically:**
- No meetings before 9am (stored in preferences collection)
- No meetings on deep work days (e.g. Thursday)
- Preferred meeting length per type (1-on-1 = 30min, team sync = 45min)

**Agent-to-agent protocol:** When A's agent needs to book with B, A's agent calls Hermes subagent spawning. The subagent reads B's calendar via B's Auth0-stored Nylas token. This is the agent-to-agent communication — no human from B's side involved.

**Confirmation gate:** Before booking, agent always says "Confirming: 4pm Thursday with Sarah, 30 minutes — say okay to book." User confirms. Then it books.

**Model:** Claude Sonnet 4.5 via Lava (negotiation logic needs reasoning)
**Auth:** Auth0 AI stores Nylas OAuth tokens per user — agent retrieves token, calls Nylas calendar API
**MongoDB reads:** calendars, preferences
**MongoDB writes:** calendars (new events), agents (log)

**API routes:**
- POST /api/agents/schedule/find — find mutual free slot given participants + preferred time
- POST /api/agents/schedule/book — book the slot (requires confirmed=true flag)
- POST /api/agents/schedule/cancel — cancel a meeting + notify attendees
- POST /api/agents/schedule/reschedule — find next slot and move meeting
- GET /api/agents/schedule/availability?userId=xxx&date=xxx — get free slots for a user on a date

---

### Agent 4: Neo Root (root cause detective)

**What it does:** Given any delayed PR or ticket, agent traces back through Slack threads, Jira comments, GitHub review history — all stored in MongoDB with vector embeddings. Returns the actual human reason for the delay with the person's name and what needs to happen next.

**Example output:** "Sarah's PR is 3 days late because it's waiting on a design approval from Mark. Mark hasn't responded to 3 Slack messages in #design channel. Recommended action: escalate to Mark's manager or reassign the design review."

**How it retrieves:** Uses MongoDB Atlas Vector Search on messages + tickets + prs collections. Semantic search finds all context related to the PR even if different words used. Then Claude reasons over the retrieved chunks.

**Confidence threshold:** If the top retrieved context scores below 0.7 similarity, agent says "I don't have enough information to determine the root cause — here's what I do know" and shows partial evidence. Never makes up an answer.

**Citation:** Every answer shows which Slack message, which Jira comment, which PR review it used as evidence. User can click through to the original.

**Model:** Claude Sonnet 4.5 via Lava (multi-step reasoning over evidence)
**MongoDB:** Atlas Vector Search on messages + tickets + prs, Voyage AI embeddings
**MongoDB writes:** agents (log query + result)

**API routes:**
- POST /api/agents/rootcause — takes prId or ticketId, returns root cause analysis with evidence
- GET /api/agents/rootcause/history?teamId=xxx — past root cause analyses for the team

---

### Agent 5: Neo Sprint (forecaster + release narrator)

**What it does:** Two jobs. First: every Monday morning, reads sprint velocity, open PRs, blocker count, and remaining work from MongoDB. Calculates if the sprint is on track. Speaks the forecast via ElevenLabs. Second: every sprint close, reads all merged PRs and writes release notes in plain English formatted for internal team vs customers.

**Sprint forecast output example:** "Sprint is at risk. At current velocity you'll complete 18 of 24 story points. The bottleneck is 4 unreviewed PRs — all assigned to Alex who has 5 meetings tomorrow. Recommend: redistribute 2 PRs to Sam who has capacity."

**Release notes output:** Takes all merged PRs from the sprint. Groups by type (feature, bugfix, infra). Writes plain English for each. Formats two versions — internal (technical) and external (customer-facing, no jargon).

**Sprint retro auto-draft:** At sprint end, agent drafts the retrospective: what went well (velocity, PR merge time), what didn't (blockers, missed stories), patterns compared to last 3 sprints. Team fills in the learnings.

**Model:** Claude Sonnet 4.5 via Lava for forecast reasoning. Groq for release notes (structured output).
**Voice:** ElevenLabs for Monday forecast delivery
**MongoDB reads:** sprints, prs (merged this sprint), agents (blocker history)
**MongoDB writes:** sprints (forecast field), briefs (sprint summary), agents (log)
**Trigger:** Inngest cron — Monday 8am for forecast, sprint close date for release notes

**API routes:**
- POST /api/agents/sprint/forecast — generate sprint forecast for a team
- POST /api/agents/sprint/release-notes — generate release notes from merged PRs
- POST /api/agents/sprint/retro — generate sprint retrospective draft
- GET /api/agents/sprint?teamId=xxx — current sprint health dashboard data

---

## Data Ingestion Pipeline

Every data source feeds into MongoDB via webhooks + Inngest background jobs.

### GitHub ingestion
- Set up a GitHub App or webhook on the repo
- Every PR open/update/close/merge fires a webhook to POST /api/webhooks/github
- Webhook handler upserts into prs collection
- Also embeds PR title + body + comments using Voyage AI and stores vector in Atlas
- File paths stored as array for reviewer routing

### Slack ingestion
- Slack Events API — subscribe to message.channels and app_mention events
- Every message fires to POST /api/webhooks/slack
- Handler stores message in messages collection
- Embeds message text with Voyage AI for semantic search
- Mentions array extracted from message blocks

### Jira ingestion
- Jira webhooks on issue created/updated/commented
- POST /api/webhooks/jira
- Upserts into tickets collection
- Priority mapped: Highest=1, High=2, Medium=3, Low=4, Lowest=5

### Calendar ingestion
- Nylas webhook on calendar event created/updated/deleted per user
- POST /api/webhooks/nylas
- Upserts into calendars collection
- Used by scheduling agent for availability checks

### Embedding strategy
- Chunk size: 512 tokens with 50 token overlap
- PR: title + body = one chunk. Each comment = separate chunk with parent prId reference
- Slack: whole thread = one chunk. Individual messages too small alone.
- Jira ticket: title + description = one chunk. Each comment = separate chunk.
- All chunks get metadata stamped: source, authorId, teamId, createdAt — for filtered search

**API routes for webhooks:**
- POST /api/webhooks/github — receives GitHub PR events
- POST /api/webhooks/slack — receives Slack message events
- POST /api/webhooks/jira — receives Jira issue events
- POST /api/webhooks/nylas — receives calendar events

---

## Auth Architecture (Auth0 AI)

Auth0 handles two things: user login and OAuth token storage per user.

**User login:** Standard Auth0 Next.js SDK. Google and GitHub login. Session stored in cookie.

**OAuth token vault:** When a user connects GitHub/Slack/Jira/Calendar:
1. User clicks "Connect GitHub" in settings
2. Auth0 runs OAuth flow for GitHub
3. GitHub access token stored securely in Auth0 token vault, linked to the user's Auth0 profile
4. When an agent needs to call GitHub on behalf of this user, it retrieves the token from Auth0 vault
5. Token is scoped — GitHub token only has repo read access, not write. Jira token only has issue read.

This is the OAuth-scoped agent model — each agent only accesses what it needs.

**API routes:**
- GET /api/auth/login — Auth0 login redirect
- GET /api/auth/callback — Auth0 callback handler
- GET /api/auth/logout — clear session
- GET /api/auth/me — current user profile + connected integrations
- POST /api/auth/connect/github — trigger GitHub OAuth flow
- POST /api/auth/connect/slack — trigger Slack OAuth flow
- POST /api/auth/connect/jira — trigger Jira OAuth flow
- POST /api/auth/connect/calendar — trigger Google/Outlook calendar OAuth via Nylas
- DELETE /api/auth/disconnect/:integration — revoke token + disconnect

---

## API Routes — Complete List

### Agent routes
- POST /api/agents/brief — generate morning or evening brief
- GET /api/agents/brief?userId=xxx — brief history
- GET /api/agents/pr?teamId=xxx — all PRs with blocker status
- POST /api/agents/pr/scan — scan team for blockers
- POST /api/agents/pr/route — smart reviewer suggestion
- POST /api/agents/pr/nudge — send Slack nudge (with confirmation)
- POST /api/agents/pr/merge-check — merge readiness checklist
- POST /api/agents/schedule/find — find mutual free slot
- POST /api/agents/schedule/book — book a meeting
- POST /api/agents/schedule/cancel — cancel a meeting
- POST /api/agents/schedule/reschedule — move a meeting
- GET /api/agents/schedule/availability — free slots for a user
- POST /api/agents/rootcause — root cause analysis for a PR or ticket
- GET /api/agents/rootcause/history?teamId=xxx — past analyses
- POST /api/agents/sprint/forecast — sprint risk forecast
- POST /api/agents/sprint/release-notes — generate release notes
- POST /api/agents/sprint/retro — generate retro draft
- GET /api/agents/sprint?teamId=xxx — sprint dashboard data

### Webhook routes (data ingestion)
- POST /api/webhooks/github — GitHub PR events
- POST /api/webhooks/slack — Slack message events
- POST /api/webhooks/jira — Jira issue events
- POST /api/webhooks/nylas — Calendar events

### Auth routes
- GET /api/auth/login
- GET /api/auth/callback
- GET /api/auth/logout
- GET /api/auth/me
- POST /api/auth/connect/:integration
- DELETE /api/auth/disconnect/:integration

### User + team routes
- GET /api/users/me — current user profile
- PUT /api/users/me — update preferences (no meeting before X, deep work days)
- GET /api/teams/:teamId — team info + member list
- POST /api/teams — create a team
- POST /api/teams/:teamId/invite — invite a teammate (they get their own Neo agent)
- GET /api/teams/:teamId/members — list members + their connected integrations

### Data routes (for dashboard)
- GET /api/data/prs?teamId=xxx — pull requests
- GET /api/data/tickets?teamId=xxx — tickets
- GET /api/data/sprint?teamId=xxx — current sprint
- GET /api/data/activity?teamId=xxx — recent team activity feed

---

## UI — Keep It Simple

Two pages only:

**`/` — Main Dashboard**
- One big "Talk to Neo" button in the center
- Shows 5 agent status cards (Brief / PR / Sched / Root / Sprint) — just name + last run time + status badge
- Voice player bar at bottom when a brief is playing
- No sidebar, no complex nav

**`/settings` — Connections**
- One card per integration: GitHub, Slack, Jira, Google Calendar
- Each card has a single "Connect" button that triggers OAuth
- Shows "Connected ✓" with the account name once linked
- No other settings for now

---

## Voice Architecture

Voice briefings use a two-step pipeline:

**Step 1 — Script generation:** Claude Haiku via Lava writes the spoken script. Max 180 words (90 seconds spoken). No bullet points — conversational prose only.

**Step 2 — TTS streaming:** Script sent to ElevenLabs `eleven_turbo_v2`. Streams back as `audio/mpeg`. Web Audio API plays chunks as they arrive. First word in ~300ms.

**Voice input:** Browser Web Speech API. User clicks "Talk to Neo", speaks, transcript sent to agent endpoint. Agent responds in text first, then speaks via ElevenLabs.

---

## Hackathon Build Order (8 hours)

**Hours 0–1: Foundation**
Set up Next.js + Vercel. MongoDB Atlas cluster. Seed database with mock data (10 PRs, 5 tickets, 20 Slack messages, 2 user calendars). Set up Lava account + API key. Do NOT spend time on real OAuth — hardcode tokens for hackathon.

**Hours 1–2: Data layer**
Write the MongoDB seed script. Create all collections. Set up Atlas Vector Search index on messages.text and prs.body using Voyage AI embeddings. Run seed script. Verify data is in Mongo.

**Hours 2–3: Agent 2 (PR blocker)**
Build the simplest agent first. GET /api/agents/pr?teamId=xxx returns blocked PRs from MongoDB. POST /api/agents/pr/scan calls Groq via Lava, returns analysis. Show results in a simple Next.js page. Proves the agent loop works end to end.

**Hours 3–4: Agent 4 (Root cause)**
POST /api/agents/rootcause takes a prId. Runs Atlas Vector Search across messages + tickets. Sends context to Claude Sonnet via Lava. Returns "blocked because X" with evidence. Show in UI with source citations. This is the demo wow moment.

**Hours 4–5: Agent 1 (Brief + ElevenLabs)**
POST /api/agents/brief writes the script with Claude Haiku via Lava. Pipe to ElevenLabs stream. Play audio in browser. This is when the room goes quiet at the demo. Add a simple "play morning brief" button on the dashboard.

**Hours 5–6: Agent 3 (Scheduling)**
Hardcode two mock calendars in MongoDB. POST /api/agents/schedule/find checks availability. POST /api/agents/schedule/book books it. Show the negotiation steps live in the UI as the agent tries each time slot. Confirmation gate: "say okay to book" before finalizing.

**Hours 6–7: Agent 5 (Sprint forecast)**
POST /api/agents/sprint/forecast reads sprint data, calls Claude, returns risk assessment with voice output via ElevenLabs. Connect all 5 agents into one dashboard page. Each agent gets a card showing its status.

**Hours 7–8: Demo polish**
One clean URL. Dashboard shows all 5 agent cards live. Voice brief plays on page load. Root cause query works with a text input. Scheduling shows step-by-step negotiation. Open Lava dashboard on second screen showing real token cost per agent — proves production readiness to judges.

---

## Seed Data Script

Write a script at `scripts/seed.ts` that inserts mock data into MongoDB:

- 10 open PRs across 3 authors. Make 4 of them stale (updatedAt older than 24 hours). Two PRs touch the same files (to demo conflict detection).
- 6 Jira tickets. 1 is P1, 2 are P2. 3 are blocked by PRs.
- 20 Slack messages. Include 3 threads where someone is clearly asking for help. Include messages mentioning specific PR names.
- 2 user calendars. User A has a meeting at 3pm. User B has a meeting at 4pm. Both are free at 5pm. (For scheduling demo to work cleanly.)
- 1 sprint with 24 story points, 8 already complete, 4 blocked by PRs.
- 2 user preference docs — one person blocks before 9am, one blocks Thursdays.

---

## Environment Variables

```
MONGODB_URI=mongodb+srv://...
MONGODB_DB=neosis
LAVA_API_KEY=lava_...
LAVA_BASE_URL=https://gateway.lava.so/v1
ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID=21m00Tcm4TlvDq8ikWAM
AUTH0_SECRET=...
AUTH0_BASE_URL=http://localhost:3000
AUTH0_ISSUER_BASE_URL=https://your-tenant.auth0.com
AUTH0_CLIENT_ID=...
AUTH0_CLIENT_SECRET=...
SLACK_BOT_TOKEN=xoxb-...
VOYAGE_API_KEY=...
NYLAS_API_KEY=...
INNGEST_EVENT_KEY=...
```

---


## What Lava Gives You For Free

- One API key, 38+ models — never manage multiple API keys
- Per-agent spend tracking — see cost of Neo Brief vs Neo PR vs Neo Root separately
- Usage metering per user — charge customers based on actual token usage
- Credit wallet system — customers prepay, Lava deducts per call
- Revenue dashboard — real-time revenue, customer analytics, margin visibility
- Model routing — cheapest model for each task automatically

Pass `x-lava-agent-id: neo-brief` (or neo-pr, neo-sched, neo-root, neo-sprint) in every API call header to get per-agent cost breakdown in the Lava dashboard.

---

## Folder Structure & File Ownership

```
neosis/
├── app/
│   ├── page.tsx                    — [SAI] main dashboard: Talk to Neo button + 5 agent cards
│   ├── settings/page.tsx           — [SAI] connections page: GitHub/Slack/Jira/Calendar OAuth buttons
│   ├── layout.tsx                  — [SAI] root layout + Auth0 provider
│   ├── api/
│   │   ├── agents/
│   │   │   ├── brief/route.ts      — [KESHAV] Agent 1: morning/evening brief + ElevenLabs stream
│   │   │   ├── pr/route.ts         — [DHARMA] Agent 2: PR blocker scan + reviewer routing + nudge
│   │   │   ├── schedule/route.ts   — [SAI] Agent 3: meeting negotiator + Nylas booking
│   │   │   ├── rootcause/route.ts  — [VEDA] Agent 4: root cause via Atlas Vector Search
│   │   │   └── sprint/route.ts     — [KESHAV] Agent 5: sprint forecast + release notes
│   │   ├── webhooks/
│   │   │   ├── github/route.ts     — [DHARMA] GitHub PR events → prs collection
│   │   │   ├── slack/route.ts      — [KESHAV] Slack messages → messages collection
│   │   │   ├── jira/route.ts       — [VEDA] Jira tickets → tickets collection
│   │   │   └── nylas/route.ts      — [SAI] Calendar events → calendars collection
│   │   ├── auth/
│   │   │   └── [...auth0]/route.ts — [SAI] Auth0 catch-all handler
│   │   ├── users/
│   │   │   └── me/route.ts         — [SAI] current user + connected integrations
│   │   └── data/
│   │       ├── prs/route.ts        — [VEDA] PR list for dashboard
│   │       ├── tickets/route.ts    — [VEDA] ticket list for dashboard
│   │       └── sprint/route.ts     — [KESHAV] sprint dashboard data
├── lib/
│   ├── mongodb.ts                  — [DHARMA] MongoDB client + collection constants
│   ├── lava.ts                     — [DHARMA] Lava gateway client + model routing table
│   ├── elevenlabs.ts               — [KESHAV] ElevenLabs TTS streaming client
│   ├── auth0.ts                    — [SAI] Auth0 AI client + token vault helpers
│   └── voyage.ts                   — [VEDA] Voyage AI embedding client
├── components/
│   ├── AgentCard.tsx               — [SAI] agent status card (name + last run + badge)
│   ├── VoicePlayer.tsx             — [SAI] audio player bar for brief streaming
│   └── ConnectionCard.tsx          — [SAI] OAuth connect/disconnect card for settings
├── scripts/
│   └── seed.ts                     — [DHARMA] seed MongoDB with mock hackathon data
├── .env.example
└── package.json
```

---

## First Prompt for Claude Code

When you open Claude Code, paste this:

"Build the Neosis project based on the architecture in ARCHITECTURE.md. Start with:
1. Create the folder structure exactly as specified
2. Set up lib/mongodb.ts, lib/lava.ts, lib/elevenlabs.ts
3. Build the seed script at scripts/seed.ts with realistic mock data
4. Build Agent 2 (PR blocker) at app/api/agents/pr/route.ts first — it's the simplest
5. Build Agent 4 (root cause) at app/api/agents/rootcause/route.ts second
6. Build Agent 1 (brief + voice) at app/api/agents/brief/route.ts third
7. Build the dashboard page with all 5 agent cards
Use TypeScript throughout. Use the MODELS and COLLECTIONS constants from the lib files."
