# Keshav — Work File

## Your Branch: `feature/brief-sprint-agents`

```bash
# One-time setup — run this first before touching any files
git checkout main
git pull origin main
git checkout -b feature/brief-sprint-agents
git push -u origin feature/brief-sprint-agents

# After each chunk of work — commit and push
git add lib/elevenlabs.ts
git commit -m "feat: elevenlabs TTS streaming client"
git push

git add app/api/agents/brief/route.ts
git commit -m "feat: agent 1 morning/evening brief with voice"
git push

git add app/api/agents/sprint/route.ts
git commit -m "feat: agent 5 sprint forecast and release notes"
git push

git add app/api/webhooks/slack/route.ts app/api/data/sprint/route.ts
git commit -m "feat: slack webhook ingestion and sprint data route"
git push

# Run your tests
npm run test:keshav

# When everything is done — open a PR on GitHub
# Go to github.com/[repo] → Pull Requests → New Pull Request
# Base: main  ←  Compare: feature/brief-sprint-agents
# Title: "feat: Agent 1 (Brief + Voice) + Agent 5 (Sprint)"
```

**Rules:**
- Never commit directly to `main`
- Never touch files owned by Dharma, Veda, or Sai
- Wait for Dharma's `lib/mongodb.ts` and `lib/lava.ts` to be pushed before starting agent routes
- Check Dharma's branch for his lib files: `git fetch && git checkout feature/foundation-pr-agent -- lib/mongodb.ts lib/lava.ts` if you need them before his PR merges

---
> Agent 1 (Brief + Voice) + Agent 5 (Sprint) + Slack webhook
> Files you own: lib/elevenlabs.ts, app/api/agents/brief/route.ts, app/api/agents/sprint/route.ts, app/api/webhooks/slack/route.ts, app/api/data/sprint/route.ts

---

## MUST DO (demo breaks without these)

- [ ] `lib/elevenlabs.ts` — ElevenLabs TTS streaming client
  - Export `streamSpeech(text: string): ReadableStream`
  - Model: `eleven_turbo_v2`
  - Voice ID: `process.env.ELEVENLABS_VOICE_ID` (default: `21m00Tcm4TlvDq8ikWAM`)
  - Return raw audio stream as `audio/mpeg` — do NOT buffer the full file
  - Chunks should stream back to browser as they arrive

- [ ] `app/api/agents/brief/route.ts` — Agent 1: morning/evening brief
  - `POST /api/agents/brief` with body `{ userId, type: "morning" | "evening" }`
    - Read from MongoDB: prs (open, assigned to user), tickets (user's P1/P2), messages (user's mentions last 24h), calendars (user's events today)
    - Call `lavaChat("neo-brief", prompt)` — model: `claude-haiku-4-5-20251001`
    - Prompt instructs: write as natural spoken prose, max 180 words, no bullet points, no headers
    - If request has `Accept: audio/mpeg` header → pipe script through `streamSpeech()` and return audio stream
    - Else → return `{ script: "..." }` JSON
    - Write generated brief to `briefs` collection
  - `GET /api/agents/brief?userId=xxx` — returns last 5 briefs from MongoDB

- [ ] `app/api/agents/sprint/route.ts` — Agent 5: sprint
  - `POST /api/agents/sprint/forecast` with body `{ teamId }`
    - Read sprint from MongoDB: velocity, story points, blocked PRs count, open tickets
    - Call `lavaChat("neo-sprint", prompt)` — model: `claude-sonnet-4-6`
    - Returns: `{ onTrack: bool, pointsAtRisk: number, bottleneck: string, recommendation: string }`
    - Optionally stream as audio via ElevenLabs if `Accept: audio/mpeg`
  - `POST /api/agents/sprint/release-notes` with body `{ teamId, sprintId }`
    - Read all merged PRs for the sprint from MongoDB
    - Call `lavaChat("neo-sprint-notes", prompt)` — model: `groq/llama-3.1-70b-versatile`
    - Returns: `{ internal: string, external: string }` — two versions of release notes
  - `POST /api/agents/sprint/retro` with body `{ teamId, sprintId }`
    - Generates retro draft: what went well, what didn't, patterns vs last 3 sprints
    - Model: `groq/llama-3.1-70b-versatile`
  - `GET /api/agents/sprint?teamId=xxx` — current sprint dashboard data from MongoDB

- [ ] `app/api/webhooks/slack/route.ts` — Slack message ingestion
  - Receives Slack Events API payloads (message.channels, app_mention)
  - Handles Slack URL verification challenge (returns `challenge` field)
  - Upserts into `messages` collection: messageId, channelId, author, text, mentions, threadId, teamId, createdAt
  - Trigger Voyage AI embedding on `text` field and store vector — coordinate with Veda on embedding format
  - Returns 200 immediately

- [ ] `app/api/data/sprint/route.ts`
  - `GET /api/data/sprint?teamId=xxx` — returns sprint + story points + velocity from MongoDB

---

## TODO (add if time allows)

- [ ] Inngest cron job that triggers `POST /api/agents/brief` at 7am and 6pm per user timezone
- [ ] Add waveform animation to brief audio player (coordinate with Sai — she builds the component, you provide the audio stream)
- [ ] Sprint forecast voice delivery — speak Monday morning forecast automatically

---

## Env vars you need
```
MONGODB_URI=
MONGODB_DB=neosis
LAVA_API_KEY=
LAVA_BASE_URL=https://gateway.lava.so/v1
ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID=21m00Tcm4TlvDq8ikWAM
VOYAGE_API_KEY=    (for Slack message embeddings)
INNGEST_EVENT_KEY= (optional for cron)
```

---

## Coordinate with
- **Dharma** — you import `lavaChat` and `COLLECTIONS` from `lib/lava.ts` and `lib/mongodb.ts`. Wait for those to be ready before starting agent routes.
- **Sai** — she builds `VoicePlayer.tsx` component. Give her the audio stream endpoint URL: `POST /api/agents/brief` with `Accept: audio/mpeg`. She just needs to hit that and play the stream.
- **Veda** — she handles Voyage embeddings in `lib/voyage.ts`. Coordinate on how to call `embed(text)` from your Slack webhook handler.
