# Veda — Work File

## Your Branch: `feature/rootcause-agent`

```bash
# One-time setup — run this first before touching any files
git checkout main
git pull origin main
git checkout -b feature/rootcause-agent
git push -u origin feature/rootcause-agent

# After each chunk of work — commit and push
git add lib/voyage.ts
git commit -m "feat: voyage AI embedding client"
git push

git add app/api/agents/rootcause/route.ts
git commit -m "feat: agent 4 root cause with atlas vector search"
git push

git add app/api/webhooks/jira/route.ts
git commit -m "feat: jira webhook ingestion with embeddings"
git push

git add app/api/data/prs/route.ts app/api/data/tickets/route.ts
git commit -m "feat: PR and ticket data routes for dashboard"
git push

# Run your tests
npm run test:veda

# When everything is done — open a PR on GitHub
# Go to github.com/[repo] → Pull Requests → New Pull Request
# Base: main  ←  Compare: feature/rootcause-agent
# Title: "feat: Agent 4 (Root Cause) + embeddings + data routes"
```

**Rules:**
- Never commit directly to `main`
- Never touch files owned by Dharma, Keshav, or Sai
- Wait for Dharma's `lib/mongodb.ts` and `lib/lava.ts` before building rootcause route
- Atlas Vector Search indexes must be created manually in MongoDB Atlas UI before the agent will work — do this early

---
> Agent 4 (Root Cause) + Jira webhook + Embeddings + Data routes
> Files you own: lib/voyage.ts, app/api/agents/rootcause/route.ts, app/api/webhooks/jira/route.ts, app/api/data/prs/route.ts, app/api/data/tickets/route.ts

---

## MUST DO (demo breaks without these)

- [ ] `lib/voyage.ts` — Voyage AI embedding client
  - Export `embed(text: string): Promise<number[]>` — returns a single embedding vector
  - Export `embedBatch(texts: string[]): Promise<number[][]>` — batch version
  - Model: `voyage-code-2` (best for mixed code + text)
  - Use `process.env.VOYAGE_API_KEY`
  - This is used by: your jira webhook, Keshav's slack webhook, Dharma's github webhook

- [ ] Atlas Vector Search setup (do this manually in MongoDB Atlas UI — not in code)
  - Create index on `neosis.messages` field `embedding` — dimensions: 1536, similarity: cosine
  - Create index on `neosis.prs` field `embedding` — dimensions: 1536, similarity: cosine
  - Create index on `neosis.tickets` field `embedding` — dimensions: 1536, similarity: cosine
  - Name each index: `messages_vector`, `prs_vector`, `tickets_vector`

- [ ] `app/api/agents/rootcause/route.ts` — Agent 4: root cause detective
  - `POST /api/agents/rootcause` with body `{ prId? , ticketId? }`
    - Step 1: Get the target PR or ticket from MongoDB by ID
    - Step 2: Embed the title + description using `embed()` from `lib/voyage.ts`
    - Step 3: Run Atlas Vector Search across `messages`, `tickets`, `prs` collections using the embedding
      - Filter by `teamId` to keep results scoped
      - Top 10 results per collection, similarity threshold >= 0.7
    - Step 4: If best similarity < 0.7 → return `{ confident: false, partial: [...evidence] }` — never hallucinate
    - Step 5: Call `lavaChat("neo-root", prompt)` — model: `claude-sonnet-4-6`
      - Prompt includes all retrieved chunks as context
      - Instruct Claude: cite every source (messageId, prId, ticketId) in the response
    - Returns: `{ cause: string, blockedBy: string, recommendedAction: string, evidence: [{ source, id, text }], confident: bool }`
  - `GET /api/agents/rootcause/history?teamId=xxx` — last 20 root cause analyses from `agents` collection

- [ ] `app/api/webhooks/jira/route.ts` — Jira ticket ingestion
  - Receives Jira webhook events: issue_created, issue_updated, comment_created
  - Upserts into `tickets` collection: ticketId, title, description, status, priority (map Highest→1, High→2, Medium→3, Low→4, Lowest→5), assignee, reporter, sprintId, teamId, blockedBy, createdAt, updatedAt
  - Embed `title + " " + description` using `embed()` and store as `embedding` field
  - Returns 200 immediately

- [ ] `app/api/data/prs/route.ts`
  - `GET /api/data/prs?teamId=xxx` — returns all open PRs for a team from MongoDB
  - Include: prId, title, author, waitHours (now - updatedAt), approvals, state

- [ ] `app/api/data/tickets/route.ts`
  - `GET /api/data/tickets?teamId=xxx` — returns open tickets for a team
  - Include: ticketId, title, priority, status, assignee, blockedBy

---

## TODO (add if time allows)

- [ ] Add confidence score to root cause response — show it in the UI (Sai's AgentCard)
- [ ] Add `GET /api/agents/rootcause/history?teamId=xxx` filtering by date range
- [ ] Embed PR comments separately (not just title+body) for richer context

---

## How Atlas Vector Search query works (use this exact aggregation pipeline)

```js
db.messages.aggregate([
  {
    $vectorSearch: {
      index: "messages_vector",
      path: "embedding",
      queryVector: <your embedded query vector>,
      numCandidates: 50,
      limit: 10,
      filter: { teamId: teamId }
    }
  },
  { $addFields: { score: { $meta: "vectorSearchScore" } } },
  { $match: { score: { $gte: 0.7 } } }
])
```
Run the same pipeline on `prs` (index: `prs_vector`) and `tickets` (index: `tickets_vector`), merge results, pass all to Claude.

---

## Env vars you need
```
MONGODB_URI=
MONGODB_DB=neosis
LAVA_API_KEY=
LAVA_BASE_URL=https://gateway.lava.so/v1
VOYAGE_API_KEY=
```

---

## Coordinate with
- **Dharma** — you import `lavaChat` and `COLLECTIONS` from his lib files. Wait for those before building rootcause route.
- **Keshav** — he calls your `embed()` function in the Slack webhook handler. Export it from `lib/voyage.ts` and tell him the function signature.
- **Sai** — she displays root cause results in the dashboard. Your response shape `{ cause, blockedBy, recommendedAction, evidence, confident }` must stay stable — tell her if you change it.
