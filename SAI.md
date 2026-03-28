# Sai — Work File

## Your Branch: `feature/ui-scheduling-agent`

```bash
# One-time setup — run this first before touching any files
git checkout main
git pull origin main
git checkout -b feature/ui-scheduling-agent
git push -u origin feature/ui-scheduling-agent

# After each chunk of work — commit and push
git add lib/auth0.ts
git commit -m "feat: auth0 client and OAuth token vault helpers"
git push

git add app/api/auth app/api/users/me/route.ts
git commit -m "feat: auth routes and user profile endpoint"
git push

git add app/api/agents/schedule/route.ts app/api/webhooks/nylas/route.ts
git commit -m "feat: agent 3 scheduling and nylas webhook"
git push

git add app/page.tsx app/settings/page.tsx app/layout.tsx
git commit -m "feat: main dashboard and settings page UI"
git push

git add components/AgentCard.tsx components/VoicePlayer.tsx components/ConnectionCard.tsx
git commit -m "feat: AgentCard, VoicePlayer, ConnectionCard components"
git push

# Run your tests
npm run test:sai

# When everything is done — open a PR on GitHub
# Go to github.com/[repo] → Pull Requests → New Pull Request
# Base: main  ←  Compare: feature/ui-scheduling-agent
# Title: "feat: UI + Agent 3 (Scheduling) + Auth"
```

**Rules:**
- Never commit directly to `main`
- Never touch files owned by Dharma, Keshav, or Veda
- UI can be built before all agents are ready — use mock data for the cards initially
- When pulling other agents' work to test in UI: `git fetch origin && git merge origin/feature/foundation-pr-agent` (only when Dharma says his branch is ready)

---
> Agent 3 (Scheduling) + Auth + Frontend UI + Nylas webhook
> Files you own: lib/auth0.ts, app/api/agents/schedule/route.ts, app/api/webhooks/nylas/route.ts, app/api/auth/[...auth0]/route.ts, app/api/users/me/route.ts, app/page.tsx, app/settings/page.tsx, app/layout.tsx, components/AgentCard.tsx, components/VoicePlayer.tsx, components/ConnectionCard.tsx

---

## MUST DO (demo breaks without these)

- [ ] `lib/auth0.ts` — Auth0 AI client + OAuth token vault helpers
  - Export `getTokenForUser(userId, integration)` — retrieves stored OAuth token from Auth0 vault
  - Integration values: `"github"`, `"slack"`, `"jira"`, `"calendar"`
  - Export `saveToken(userId, integration, token)` — stores token in vault
  - Use `process.env.AUTH0_*` vars

- [ ] `app/api/auth/[...auth0]/route.ts` — Auth0 catch-all
  - Standard Auth0 Next.js SDK handler
  - Handles: `/api/auth/login`, `/api/auth/callback`, `/api/auth/logout`

- [ ] `app/api/users/me/route.ts`
  - `GET /api/users/me` — returns current user from Auth0 session + which integrations are connected
  - Response: `{ userId, name, email, connected: { github: bool, slack: bool, jira: bool, calendar: bool } }`
  - `POST /api/auth/connect/:integration` — triggers OAuth redirect for that integration
  - `DELETE /api/auth/disconnect/:integration` — revokes + removes token

- [ ] `app/api/agents/schedule/route.ts` — Agent 3: meeting negotiator
  - `POST /api/agents/schedule/find` with body `{ participantIds: string[], preferredTime?: string, durationMins: number }`
    - Read calendars for all participants from MongoDB `calendars` collection
    - Call `lavaChat("neo-sched", prompt)` — model: `claude-sonnet-4-6`
    - Claude finds the best mutual free slot respecting preferences (no meetings before/after hours, no deep work days from `preferences` collection)
    - Returns: `{ slot: { start, end }, participants: string[], confirmationRequired: true }`
    - NEVER books automatically — always return `confirmationRequired: true`
  - `POST /api/agents/schedule/book` with body `{ slot, participants, confirmed: true }`
    - Only proceeds if `confirmed === true`
    - Inserts event into MongoDB `calendars` collection
    - Calls Nylas to create real calendar invite (if Nylas token available)
    - Returns: `{ eventId, slot, participants, booked: true }`
  - `POST /api/agents/schedule/cancel` — removes event from calendars collection + Nylas
  - `POST /api/agents/schedule/reschedule` — find + book calls combined
  - `GET /api/agents/schedule/availability?userId=xxx&date=xxx` — free slots for a user on a date

- [ ] `app/api/webhooks/nylas/route.ts` — calendar event ingestion
  - Receives Nylas webhook: event created/updated/deleted per user
  - Upserts into `calendars` collection: eventId, userId, title, start, end, attendees, createdAt
  - Returns 200 immediately

- [ ] `app/page.tsx` — Main dashboard (KEEP IT SIMPLE)
  - Center of page: one large "Talk to Neo" button
  - On click: open browser mic (Web Speech API), capture speech, POST transcript to relevant agent endpoint based on intent
  - Below button: 5 agent status cards using `AgentCard` component
    - Cards show: agent name, last run time, status badge (idle / running / error)
    - Do NOT add complex interactions to cards — just display
  - Bottom bar: `VoicePlayer` component (hidden until a brief is playing)
  - No sidebar, no complex nav, no extra pages linked from here except `/settings`

- [ ] `app/settings/page.tsx` — Connections page (KEEP IT SIMPLE)
  - 4 `ConnectionCard` components: GitHub, Slack, Jira, Google Calendar
  - Each shows: integration name, icon, status ("Connected — username" or "Not connected")
  - One button per card: "Connect" (triggers OAuth) or "Disconnect"
  - Nothing else on this page

- [ ] `app/layout.tsx`
  - Auth0 provider wrapping the app
  - Tailwind base styles
  - Simple nav: just "Neosis" wordmark on the left + "Settings" link top right

- [ ] `components/AgentCard.tsx`
  - Props: `{ name: string, lastRun: string | null, status: "idle" | "running" | "error" }`
  - Simple card: agent name, status badge (green/yellow/red dot), last run relative time
  - No onClick interactions for now

- [ ] `components/VoicePlayer.tsx`
  - Props: `{ audioUrl: string | null }`
  - When `audioUrl` is set: fetch with `Accept: audio/mpeg`, stream via Web Audio API
  - Show: play/pause button + "Read instead" toggle that shows text transcript
  - Hidden when no audio is active

- [ ] `components/ConnectionCard.tsx`
  - Props: `{ integration: string, connected: bool, accountName?: string, onConnect: fn, onDisconnect: fn }`
  - Clean card: name + status text + one action button

---

## TODO (add if time allows)

- [ ] Add real Nylas calendar API calls (for now MongoDB mock is fine for demo)
- [ ] Show step-by-step slot negotiation in the UI as the scheduling agent tries each time slot
- [ ] Voice input: detect which agent to route to based on keywords in transcript ("schedule", "why is", "brief", "sprint")

---

## Env vars you need
```
MONGODB_URI=
MONGODB_DB=neosis
LAVA_API_KEY=
LAVA_BASE_URL=https://gateway.lava.so/v1
AUTH0_SECRET=
AUTH0_BASE_URL=http://localhost:3000
AUTH0_ISSUER_BASE_URL=https://your-tenant.auth0.com
AUTH0_CLIENT_ID=
AUTH0_CLIENT_SECRET=
NYLAS_API_KEY=
```

---

## Coordinate with
- **Dharma** — imports `COLLECTIONS` from `lib/mongodb.ts` for your schedule + nylas routes. Align on collection names first.
- **Keshav** — `VoicePlayer.tsx` must hit `POST /api/agents/brief` with `Accept: audio/mpeg`. He owns that endpoint — confirm the URL with him.
- **Veda** — `AgentCard` may show root cause results. Her response shape is `{ cause, blockedBy, recommendedAction, evidence, confident }`. Keep the card display simple — just show `cause` text for now.
