# Dharma — Work File

## Your Branch: `feature/foundation-pr-agent`

```bash
# One-time setup — run this first before touching any files
git checkout main
git pull origin main
git checkout -b feature/foundation-pr-agent
git push -u origin feature/foundation-pr-agent

# After each chunk of work — commit and push
git add lib/mongodb.ts lib/lava.ts scripts/seed.ts
git commit -m "feat: mongodb client and lava gateway setup"
git push

git add app/api/agents/pr/route.ts
git commit -m "feat: agent 2 PR blocker scan and nudge"
git push

git add app/api/webhooks/github/route.ts
git commit -m "feat: github webhook ingestion"
git push

# Run your tests
npm run test:dharma

# When everything is done — open a PR on GitHub
# Go to github.com/[repo] → Pull Requests → New Pull Request
# Base: main  ←  Compare: feature/foundation-pr-agent
# Title: "feat: foundation + Agent 2 (PR blocker)"
```

**Rules:**
- Never commit directly to `main`
- Never touch files owned by Keshav, Veda, or Sai
- If you need a change in someone else's file — ask them, don't edit it yourself
- Merge conflicts happen when two people edit the same file — our split prevents this

---
> Foundation + Agent 2 (PR Blocker)
> Files you own: lib/mongodb.ts, lib/lava.ts, scripts/seed.ts, app/api/agents/pr/route.ts, app/api/webhooks/github/route.ts

---

## MUST DO (demo breaks without these)

- [x] `lib/mongodb.ts` — MongoDB client singleton + export all collection name constants
  - Export: `COLLECTIONS = { prs, tickets, messages, calendars, briefs, sprints, agents, preferences }`
  - Use `process.env.MONGODB_URI` and `process.env.MONGODB_DB`
  - Single client instance (no reconnects on every call)

- [x] `lib/lava.ts` — Lava gateway client + model routing table
  - Base URL: `https://gateway.lava.so/v1`
  - Export `MODELS` constant:
    ```
    neo-brief   → claude-haiku-4-5-20251001
    neo-pr      → groq/llama-3.1-70b-versatile
    neo-sched   → claude-sonnet-4-6
    neo-root    → claude-sonnet-4-6
    neo-sprint  → claude-sonnet-4-6 (forecast) / groq/llama-3.1-70b-versatile (release notes)
    ```
  - Export `lavaChat(agentId, messages)` — sends request to Lava, injects `x-lava-agent-id` header automatically
  - Use openai SDK pointed at Lava base URL (Lava is OpenAI-compatible)

- [x] `scripts/seed.ts` — seed MongoDB with demo data
  - 10 PRs: 4 stale (updatedAt > 24h ago), 2 PRs share same files (conflict demo)
  - 6 tickets: 1 P1, 2 P2, 3 blocked by PR ids
  - 20 Slack messages: 3 threads showing someone asking for help, messages mentioning PR names
  - 2 user calendars: User A busy at 3pm, User B busy at 4pm, both free at 5pm
  - 1 sprint: 24 story points, 8 complete, 4 blocked
  - 2 preference docs: one blocks before 9am, one blocks Thursdays
  - Run with: `npm run seed`

- [x] `app/api/agents/pr/route.ts` — Agent 2: PR blocker
  - `GET /api/agents/pr?teamId=xxx` — returns all open PRs from MongoDB with wait hours calculated
  - `POST /api/agents/pr/scan` — reads prs collection, calls `lavaChat("neo-pr", ...)` to analyze blockers, returns structured list
  - `POST /api/agents/pr/route` — given prId, finds best reviewer by file history (check `files` array overlap with past PRs), returns suggestion
  - `POST /api/agents/pr/nudge` — body must include `{ prId, reviewerId, confirmed: true }` — only sends Slack message if confirmed is true
  - `POST /api/agents/pr/merge-check` — runs checklist: tests green? all approvals? no conflicts? ticket linked?

- [x] `app/api/webhooks/github/route.ts` — GitHub webhook handler
  - Receives PR open/update/close/merge events
  - Upserts into `prs` collection using `prId` as unique key
  - Stores: prId, title, body, author, files (array), state, approvals, checks, updatedAt
  - Returns 200 immediately (async upsert)

---

## TODO (add if time allows)

- [ ] Add conflict detection in PR scan: flag any 2 open PRs that share files in their `files` array
- [ ] Add PR summary post to Slack on merge (call Keshav's slack webhook endpoint)
- [ ] Add Atlas Vector Search index on `prs.body` for root cause (Veda needs this — coordinate)

---

## Env vars you need
```
MONGODB_URI=
MONGODB_DB=neosis
LAVA_API_KEY=
LAVA_BASE_URL=https://gateway.lava.so/v1
SLACK_BOT_TOKEN=   (for nudge endpoint)
```

---

## Coordinate with
- **Veda** — she imports `lavaChat` and `COLLECTIONS` from your lib files. Make sure exports match before she starts.
- **Keshav** — imports `lavaChat` and `COLLECTIONS` too. Same thing.
- **Sai** — imports `COLLECTIONS` for the data routes. Align on collection names before she builds.
