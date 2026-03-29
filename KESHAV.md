# Keshav — Work File

> Agent 1 (Brief + Voice) + Agent 5 (Sprint) + Slack webhook
> Files you own: lib/elevenlabs.ts, app/api/agents/brief/route.ts, app/api/agents/sprint/route.ts, app/api/webhooks/slack/route.ts, app/api/data/sprint/route.ts

---

## Current State

All routes are **built and working**. Models now route through Lava as `gpt-5-chat-latest`.

### Completed
- [x] `lib/elevenlabs.ts` — TTS streaming (eleven_turbo_v2, stability 0.38, similarity 0.82, style 0.28)
- [x] `app/api/agents/brief/route.ts` — Morning/evening briefs with audio streaming
- [x] `app/api/agents/sprint/route.ts` — Sprint forecast + release notes + retro drafts
- [x] `app/api/webhooks/slack/route.ts` — Slack message ingestion with embeddings
- [x] `app/api/data/sprint/route.ts` — Sprint dashboard data

### How Hermes Changes Your Agents

Hermes is the new orchestrator brain. It routes requests to your agents via `POST /api/agents/brief` and `POST /api/agents/sprint?action=forecast`. Your route handlers don't need to change — Hermes calls them with structured payloads.

**Brief agent:** Hermes delegates with `{ userId, type: "morning" | "evening" }` via endpoint `brief`
**Sprint agent:** Hermes delegates with `{ teamId }` via endpoint `sprint`, action `forecast`

The chat route (`app/api/agents/chat/route.ts`) now uses Hermes instead of keyword matching. When a user says "give me my morning brief" or "how's the sprint looking", Hermes recognizes the intent and calls your endpoints.

### Voice Pipeline
```
User speaks → Web Speech API → transcript
→ POST /api/agents/chat (Hermes routes to neo-brief or neo-sprint)
→ LLM generates response via Lava (gpt-5-chat-latest)
→ If Accept: audio/mpeg → ElevenLabs streams audio back
→ Browser plays chunks via Web Audio API
```

### ElevenLabs Conversational AI
Full-duplex voice now available via agent ID `agent_2101kmw3enfdfh1bpyyrynh831x2`. The frontend uses `@elevenlabs/react` `useConversation` hook for real-time duplex voice. Your `streamSpeech()` is still used for one-way TTS on agent responses.

---

## Env vars you need
```
MONGODB_URI=
MONGODB_DB=neosis
LAVA_API_KEY=
LAVA_BASE_URL=https://api.lava.so/v1
ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID=21m00Tcm4TlvDq8ikWAM
ELEVENLABS_CONVAI_AGENT_ID=agent_2101kmw3enfdfh1bpyyrynh831x2
```

---

## Coordinate with
- **Dharma** — `lib/mongodb.ts` and `lib/lava.ts` are stable. `lib/hermes.ts` is the new orchestrator — it calls your agents.
- **Sai** — `VoicePlayer.tsx` hits `POST /api/agents/brief` with `Accept: audio/mpeg`. ElevenLabs Conversational AI is also wired up in the frontend.
- **Veda** — `lib/voyage.ts` provides `embed()` for your Slack webhook handler.
