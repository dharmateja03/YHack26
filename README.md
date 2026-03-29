# Neosis

**AI Executive Assistant for Engineering Teams**

Neosis is a voice-first, multi-agent system that helps engineering teams manage their daily workflow — PRs, tickets, sprints, scheduling, and root cause analysis — through natural conversation with **Neo**, an AI assistant that remembers context across sessions.

Built at YHack 2026 by Dharma, Keshav, Veda, and Sai.

---

## Architecture

```
Browser (voice/text)
    │
    ▼
┌─────────────────────────────────────────────┐
│  Next.js 14 (App Router)                    │
│                                             │
│  /api/agents/chat  ← main conversational    │
│      │               endpoint               │
│      ├── intent detection                   │
│      ├── memory recall (short + long term)  │
│      ├── sub-agent delegation               │
│      └── streaming response                 │
│                                             │
│  Sub-agents:                                │
│  /api/agents/brief    → daily briefings     │
│  /api/agents/pr       → PR triage & review  │
│  /api/agents/schedule → meeting booking     │
│  /api/agents/rootcause→ blocker diagnosis   │
│  /api/agents/sprint   → forecast & retro    │
└──────┬──────────┬──────────┬────────────────┘
       │          │          │
       ▼          ▼          ▼
   Lava.so    MongoDB    ElevenLabs
   (LLM)    Atlas+Vector   (TTS)
              Search
```

## How Conversation Works

Unlike typical one-shot AI chat, Neosis maintains **multi-turn conversational memory**:

### 1. Short-term memory (current session)
Every user message and Neo response is saved as a "turn" with a session ID. When you send a new message, the last 8 turns are loaded so Neo knows what you just discussed.

### 2. Long-term memory (cross-session recall)
Each turn is embedded into a **1536-dimensional vector** using Voyage AI (`voyage-code-2`). When you ask something new:
- Your query is embedded into the same vector space
- **MongoDB Atlas Vector Search** finds semantically similar turns from ALL your past sessions
- Matches above 0.65 cosine similarity are injected as context

So if you discussed PR-42 last week and ask "what happened with that stuck PR?" today, Neo finds the relevant context — even without exact keyword matches.

### 3. Graceful degradation
- No Voyage API? → Falls back to keyword-based text search
- No MongoDB? → In-memory Map stores turns for the current server session
- No LLM? → Returns raw sub-agent data as fallback

### Flow per message:
```
User sends message
  → save turn to memory (with vector embedding)
  → build context: recent turns + recalled past memory
  → pull live data (PRs, tickets, sprint) from MongoDB
  → detect intent → delegate to sub-agent if needed
  → combine everything into LLM prompt
  → generate response via Lava.so gateway
  → save assistant turn to memory
  → stream response word-by-word to browser
```

## Voice: How Neo Talks Like a Human

### ElevenLabs Text-to-Speech

Neo uses **ElevenLabs Turbo v2** for near-real-time voice synthesis:

```
lib/elevenlabs.ts → streamSpeech(text)
  → POST /v1/text-to-speech/{voiceId}/stream
  → returns ReadableStream<Uint8Array> (audio/mpeg)
  → streamed directly to browser — no buffering
```

**Key settings for natural speech:**
| Parameter | Value | Why |
|-----------|-------|-----|
| `model_id` | `eleven_turbo_v2` | Optimized for low latency (~300ms to first word) |
| `stability` | `0.5` | Balanced — not robotic, not too variable |
| `similarity_boost` | `0.75` | Keeps the voice consistent across responses |
| `style` | `0.0` | Neutral delivery, lets content drive tone |
| `use_speaker_boost` | `true` | Clearer audio, better for speech |
| `optimize_streaming_latency` | `3` | Maximum latency optimization (1-4 scale) |

**Voice selection:**
- Default voice ID: `21m00Tcm4TlvDq8ikWAM` (Rachel — clear, professional)
- Override with `ELEVENLABS_VOICE_ID` env var
- ElevenLabs has 100+ voices — pick one that matches your team's vibe

**How audio reaches the browser:**
1. Chat endpoint generates text response
2. If client sends `Accept: audio/mpeg` header, response goes through ElevenLabs
3. Raw audio stream is piped directly to the browser (no server-side buffering)
4. Browser plays via `<audio>` element with waveform visualization
5. Text reply is sent in `X-Neo-Reply` response header as fallback

### Browser Speech (Fallback TTS)
When ElevenLabs is unavailable, Neo falls back to the **Web Speech API** (`window.speechSynthesis`) — free, instant, works offline, but sounds robotic.

### Real-time Duplex Voice — ElevenLabs Conversational AI

This is what makes Neo feel like you're *talking to a person*, not waiting for text responses.

**Agent ID:** `agent_2101kmw3enfdfh1bpyyrynh831x2`

Neo uses the ElevenLabs Conversational AI Agent platform for full-duplex, real-time voice:

```
User clicks orb / mic button
  → browser requests mic permission
  → GET /api/elevenlabs/signed-url
      → server calls ElevenLabs signed URL API (authenticated)
      → returns signed WebSocket URL
  → @elevenlabs/react opens WebSocket/WebRTC connection
  → bidirectional audio stream begins:
      User speaks → ElevenLabs STT → agent processes → TTS → user hears Neo
```

**Why this is different from the TTS approach:**
| | TTS (streamSpeech) | Conversational AI Agent |
|---|---|---|
| Latency | ~300ms first word, but you wait for full LLM response first | ~500ms end-to-end, true real-time |
| Turn-taking | User must click mic, wait, get response | Natural interruption — speak anytime |
| STT | Browser Web Speech API (Chrome only) | ElevenLabs built-in (all browsers) |
| Voice quality | Good (streaming chunks) | Better (optimized for conversation) |
| Context | Stateless per request | Maintains conversation state |

**Connection flow (with fallbacks):**
1. Try signed URL (server-authenticated, WebSocket) — most secure
2. If API key lacks `convai_write` permission → fall back to `agentId` + WebRTC (public agent)
3. If no server config → use `NEXT_PUBLIC_ELEVENLABS_AGENT_ID` directly from browser

**Frontend integration (`app/page.tsx`):**
```typescript
import { ConversationProvider, useConversation } from "@elevenlabs/react";

const conversation = useConversation({
  onConnect: () => { /* agent card glows "running" */ },
  onDisconnect: () => { /* reset agent cards */ },
  onMessage: ({ role, message }) => {
    // Real-time transcript updates — messages grow as the agent speaks
    // UI merges partial transcripts into the same bubble
  },
  onError: (message) => { /* show error under orb */ },
});

// Start live session
await conversation.startSession({ signedUrl: "wss://..." });

// Or with public agent
await conversation.startSession({
  agentId: "agent_2101kmw3enfdfh1bpyyrynh831x2",
  connectionType: "webrtc",
});

// Send text in a live session (no mic needed)
conversation.sendUserMessage("check my PRs");

// Inject context without triggering a response
conversation.sendContextualUpdate("User just opened the sprint page");
```

**Key capabilities in live mode:**
- `conversation.isSpeaking` — true when Neo is talking (shows waveform)
- `conversation.isListening` — true when listening for user input
- `conversation.sendUserMessage(text)` — type while in a live voice session
- `conversation.endSession()` — click orb again to disconnect
- Natural interruption — user can speak while Neo is responding, Neo stops and listens

### Voice Input (Speech-to-Text)
In live mode, microphone capture and turn-taking are handled by the ElevenLabs conversation session — not browser Web Speech Recognition. This works in **all browsers** (not just Chrome). Users can also type follow-up messages in the same live session via `sendUserMessage()`.

### Voice Architecture Summary

```
┌─────────────────────────────────────────────────────┐
│                   VOICE MODES                        │
├───────────────┬──────────────────┬──────────────────┤
│  Live Duplex  │  Streaming TTS   │  Browser Fallback│
│  (primary)    │  (text chat)     │  (offline)       │
├───────────────┼──────────────────┼──────────────────┤
│ ElevenLabs    │ ElevenLabs       │ Web Speech API   │
│ Conv. AI      │ eleven_turbo_v2  │ speechSynthesis  │
│ WebRTC/WS     │ REST streaming   │ Native           │
│ ~500ms e2e    │ ~300ms 1st word  │ Instant          │
│ Full-duplex   │ Half-duplex      │ Half-duplex      │
│ Built-in STT  │ Browser STT      │ Browser STT      │
│ All browsers  │ All browsers     │ Chrome/Edge      │
└───────────────┴──────────────────┴──────────────────┘

Priority: Live Duplex → Streaming TTS → Browser Fallback
```

## Voyage AI: Semantic Memory

Voyage AI powers the "remembering" layer:

```
lib/voyage.ts
  → embed(text)      → single 1536-dim vector
  → embedBatch(texts) → batch embedding
  → model: voyage-code-2
```

**Why voyage-code-2?**
- Optimized for code + technical text (perfect for engineering context)
- 1536 dimensions — good balance of precision vs storage
- Supports up to 16K tokens per input

**MongoDB Atlas Vector Search index:**
```json
{
  "name": "conversations_vector",
  "type": "vectorSearch",
  "definition": {
    "fields": [
      {
        "type": "vector",
        "path": "turns.embedding",
        "numDimensions": 1536,
        "similarity": "cosine"
      },
      {
        "type": "filter",
        "path": "userId"
      }
    ]
  }
}
```

## LLM Routing via Lava.so

Lava.so is an OpenAI-compatible gateway that routes to different models per agent:

| Agent | Model | Why |
|-------|-------|-----|
| `neo-brief` | `claude-haiku-4-5` | Fast, cheap — daily summaries |
| `neo-pr` | `groq/llama-3.1-70b` | Fast inference for PR scanning |
| `neo-sched` | `claude-sonnet-4-6` | Complex reasoning for scheduling |
| `neo-root` | `claude-sonnet-4-6` | Deep analysis for root cause |
| `neo-sprint` | `claude-sonnet-4-6` | Forecasting needs strong reasoning |
| `neo-sprint-notes` | `groq/llama-3.1-70b` | Fast for release note generation |

Each request includes `x-lava-agent-id` header for per-agent spend tracking on the Lava dashboard.

## Tech Stack

| Layer | Tech |
|-------|------|
| Framework | Next.js 14 (App Router) |
| Styling | Tailwind CSS |
| Auth | Auth0 |
| Database | MongoDB Atlas |
| Vector Search | MongoDB Atlas Vector Search |
| Embeddings | Voyage AI (`voyage-code-2`) |
| LLM Gateway | Lava.so (routes to Claude, Groq) |
| Voice (live) | ElevenLabs Conversational AI (WebRTC/WS) |
| Voice (TTS) | ElevenLabs Turbo v2 (streaming) |
| STT | ElevenLabs (live mode) / Web Speech API (fallback) |

## Environment Variables

```env
# MongoDB
MONGODB_URI=mongodb+srv://...
MONGODB_DB=neosis

# Lava.so (LLM gateway)
LAVA_API_KEY=lava-...
LAVA_BASE_URL=https://api.lava.so/v1

# ElevenLabs (voice)
ELEVENLABS_API_KEY=xi-...
ELEVENLABS_VOICE_ID=21m00Tcm4TlvDq8ikWAM             # optional, defaults to Rachel
ELEVENLABS_CONVAI_AGENT_ID=agent_2101kmw3enfdfh1bpyyrynh831x2   # Conversational AI agent
NEXT_PUBLIC_ELEVENLABS_AGENT_ID=agent_2101kmw3enfdfh1bpyyrynh831x2  # browser fallback for WebRTC

# Voyage AI (embeddings)
VOYAGE_API_KEY=voyage-...

# Auth0
AUTH0_SECRET=...
AUTH0_BASE_URL=http://localhost:3000
AUTH0_ISSUER_BASE_URL=https://your-tenant.auth0.com
AUTH0_CLIENT_ID=...
AUTH0_CLIENT_SECRET=...
```

## Getting Started

```bash
# Install
npm install

# Seed the database with sample data
npm run seed

# Seed randomized demo PRs/issues/messages
npm run seed:demo -- --prs 20 --tickets 12 --messages 30

# Optional: also send demo updates to Slack channel
npm run seed:demo -- --send-slack --channel C0123456789 --slack-count 5

# Run dev server
npm run dev

# Run tests
npm test

# Run tests for a specific team member
npm run test:dharma
npm run test:keshav
npm run test:veda
npm run test:sai
```

## Demo Slack API

POST [`/api/demo/slack`](/Users/dharmatejasamudrala/projects/YHack26/app/api/demo/slack/route.ts) to push a message into Slack and mirror it into Mongo `messages` collection.

Example body:

```json
{
  "channel": "C0123456789",
  "text": "Demo update: PR demo-pr-3 is blocked by DEMO-104"
}
```

## Making Neo Sound More Human

Tips for tuning ElevenLabs voice quality:

1. **Pick the right voice** — browse voices at [elevenlabs.io/voice-library](https://elevenlabs.io/voice-library). Clone a custom voice for a unique brand.

2. **Tune stability** — lower values (0.2-0.4) add more expressiveness and variation. Higher (0.7-0.9) for consistent, professional delivery.

3. **Write for speech, not text** — Neo's system prompt says "2-3 sentences max." Short, punchy responses sound better spoken than long paragraphs.

4. **Add SSML-style hints** — ElevenLabs responds to punctuation:
   - `...` adds a natural pause
   - `—` (em dash) creates a slight break
   - `!` adds emphasis
   - Short sentences = more natural rhythm

5. **Use streaming** — `optimize_streaming_latency: 3` gets first audio chunk in ~300ms. The user hears Neo start talking almost instantly.

6. **Fallback gracefully** — if ElevenLabs is down or slow (>15s timeout), the brief endpoint falls back to JSON text. The chat endpoint falls back to browser `speechSynthesis`.

## Team

| Member | Focus Areas |
|--------|------------|
| **Dharma** | PR agent, chat endpoint, memory system, architecture |
| **Keshav** | Sprint agent, ElevenLabs TTS, brief agent |
| **Veda** | Root cause agent, Voyage embeddings, vector search |
| **Sai** | Schedule agent, UI/frontend, connection cards |
