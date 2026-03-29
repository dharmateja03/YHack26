# Sai — Work File

> Agent 3 (Scheduling) + Auth + Frontend UI + Nylas webhook + Org system
> Files you own: lib/auth0.ts, lib/org.ts, app/api/agents/schedule/route.ts, app/api/webhooks/nylas/route.ts, app/api/auth/[...auth0]/route.ts, app/api/users/*/route.ts, app/api/orgs/*/route.ts, app/page.tsx, app/settings/page.tsx, app/layout.tsx, app/join/[token]/page.tsx, components/*

---

## Current State

All routes and UI are **built and working**. Dark theme applied. ElevenLabs Conversational AI integrated.

### Completed
- [x] `lib/auth0.ts` — Auth0 AI client + OAuth token vault helpers
- [x] `lib/org.ts` — Organization management (create, invite, redeem, member profiles)
- [x] `app/api/agents/schedule/route.ts` — Full scheduling: find, book, cancel, reschedule, reconcile, orchestrate
- [x] `app/api/webhooks/nylas/route.ts` — Calendar event ingestion
- [x] `app/page.tsx` — Main dashboard with Talk to Neo orb + 5 agent cards
- [x] `app/settings/page.tsx` — Connection cards for GitHub, Slack, Jira, Calendar
- [x] `app/layout.tsx` — Root layout with dark theme, Neosis wordmark
- [x] `app/join/[token]/page.tsx` — Org invite redemption
- [x] `components/AgentCard.tsx` — Agent status card with glow animation
- [x] `components/VoicePlayer.tsx` — Audio player bar
- [x] `components/ConnectionCard.tsx` — OAuth connect/disconnect card
- [x] Org API routes: setup, me, invites, redeem, profile

### How Hermes Changes Scheduling

Hermes is now the orchestrator brain. Instead of keyword-based routing, the chat endpoint uses Hermes to:
1. **Gather info** — asks at least 3 questions (who, priority, title, time preference) before scheduling
2. **Delegate** — calls `POST /api/agents/schedule?action=orchestrate` with full structured payload
3. **Start negotiation** — after booking, auto-creates a negotiation record and emails the participant

Your schedule route handler doesn't need to change — it receives the same payload format from Hermes as it did from the old keyword router, just with more complete data.

### Email Negotiation Flow (NEW)

After neo-sched books a slot:
1. `lib/negotiate.ts` creates a negotiation record (state: `proposed`)
2. Sends proposal email to participant via Nylas (`sendProposalEmail()`)
3. When participant replies, `app/api/agents/mail/route.ts` processes it:
   - Agreement → auto-books via `POST /api/agents/schedule?action=book`
   - Counter-proposal → finds new slot, sends counter email
   - Rejection → marks negotiation as failed
4. States: `proposed → awaiting_reply → counter → agreed → booked`

### Organization System

The org system (`lib/org.ts`) powers participant resolution:
- User says "meet with John" → Hermes extracts "john"
- Schedule route calls `resolveParticipantsFromContext()` → looks up John in the org's member list
- Finds John's email via `getWorkEmailsByUserIds()` → uses it for calendar lookup + email negotiation

Routes:
- `POST /api/orgs/setup` — create org (manager role)
- `GET /api/orgs/me` — org context for current user
- `POST /api/orgs/invites` — generate invite token
- `POST /api/orgs/invites/redeem` — join via token
- `GET/POST /api/orgs/profile` — update member profile (name, work email)

### Frontend Voice Integration

```
ElevenLabs Conversational AI (full-duplex):
  Agent ID: agent_2101kmw3enfdfh1bpyyrynh831x2
  @elevenlabs/react useConversation hook
  Signed URL auth: GET /api/elevenlabs/signed-url

One-way TTS (agent responses):
  POST /api/agents/chat with Accept: audio/mpeg
  Streams audio/mpeg back via ElevenLabs eleven_turbo_v2
```

### UI Animations (app/globals.css)
- `orb-breathe` — Talk to Neo button pulse
- `orb-listen` — Active listening state
- `typing-cursor` — Response streaming indicator
- `agent-glow` — Active agent card glow
- `slide-up` — VoicePlayer entrance
- `bar-wave` — Audio waveform bars
- `fade-up` — Agent card entrance

---

## Env vars you need
```
MONGODB_URI=
MONGODB_DB=neosis
LAVA_API_KEY=
LAVA_BASE_URL=https://api.lava.so/v1
AUTH0_SECRET=
AUTH0_BASE_URL=http://localhost:3000
AUTH0_ISSUER_BASE_URL=https://dev-....auth0.com
AUTH0_CLIENT_ID=
AUTH0_CLIENT_SECRET=
NYLAS_API_KEY=
ELEVENLABS_API_KEY=
ELEVENLABS_CONVAI_AGENT_ID=agent_2101kmw3enfdfh1bpyyrynh831x2
NEXT_PUBLIC_ELEVENLABS_AGENT_ID=agent_2101kmw3enfdfh1bpyyrynh831x2
NEO_AGENT_EMAIL=neo-agent@neosis.ai
```

---

## Coordinate with
- **Dharma** — `lib/mongodb.ts`, `lib/lava.ts`, `lib/hermes.ts` (orchestrator calls your schedule agent), `lib/negotiate.ts` (email negotiation after scheduling)
- **Keshav** — VoicePlayer hits his `POST /api/agents/brief` with `Accept: audio/mpeg`
- **Veda** — AgentCard may show root cause results from her agent
