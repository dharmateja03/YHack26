import { getDb, COLLECTIONS } from "./mongodb";
import { embed } from "./voyage";

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
  agentUsed?: string;
  embedding?: number[];
  timestamp: Date;
}

export interface ConversationDoc {
  sessionId: string;
  userId: string;
  turns: ConversationTurn[];
  createdAt: Date;
  updatedAt: Date;
}

// ── In-memory fallback when MongoDB is unavailable ────────────────
const inMemoryStore: Map<string, ConversationDoc> = new Map();

function getInMemoryDoc(sessionId: string, userId: string): ConversationDoc {
  if (!inMemoryStore.has(sessionId)) {
    inMemoryStore.set(sessionId, {
      sessionId,
      userId,
      turns: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }
  return inMemoryStore.get(sessionId)!;
}

// ── Store a turn in the conversation ──────────────────────────────
export async function saveTurn(
  sessionId: string,
  userId: string,
  role: "user" | "assistant",
  content: string,
  agentUsed?: string
): Promise<void> {
  let embedding: number[] | undefined;
  try {
    embedding = await embed(content);
  } catch (err: any) {
    console.warn("[memory] embed failed — turns saved without vector:", err?.response?.status ?? err?.message ?? "unknown");
  }

  const turn: ConversationTurn = {
    role,
    content,
    agentUsed,
    embedding,
    timestamp: new Date(),
  };

  // Try MongoDB, fall back to in-memory
  try {
    const db = await getDb();
    await db.collection(COLLECTIONS.conversations).updateOne(
      { sessionId },
      {
        $push: { turns: turn } as any,
        $set: { updatedAt: new Date(), userId },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true }
    );
  } catch {
    const doc = getInMemoryDoc(sessionId, userId);
    doc.turns.push(turn);
    doc.updatedAt = new Date();
  }
}

// ── Get recent turns from this session ────────────────────────────
export async function getRecentTurns(
  sessionId: string,
  limit = 10
): Promise<ConversationTurn[]> {
  // Try MongoDB first
  try {
    const db = await getDb();
    const doc = await db
      .collection(COLLECTIONS.conversations)
      .findOne({ sessionId });
    if (doc?.turns) return (doc.turns as ConversationTurn[]).slice(-limit);
  } catch {}

  // Fall back to in-memory
  const doc = inMemoryStore.get(sessionId);
  if (!doc?.turns) return [];
  return doc.turns.slice(-limit);
}

// ── Cosine similarity ────────────────────────────────────────────────
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

const SIMILARITY_THRESHOLD = 0.55;

// ── Semantic search across ALL past conversations ─────────────────
// Finds relevant turns from any session for this user
export async function recallRelevantMemory(
  userId: string,
  query: string,
  limit = 5
): Promise<{ content: string; role: string; agentUsed?: string; timestamp: Date; score: number }[]> {
  let queryEmbedding: number[] | null = null;
  try {
    queryEmbedding = await embed(query);
  } catch {
    // Voyage unavailable — use text fallback only
  }

  try {
    const db = await getDb();

    // Vector search: load conversations and compute cosine similarity per turn
    if (queryEmbedding) {
      const docs = await db
        .collection(COLLECTIONS.conversations)
        .find({ userId })
        .sort({ updatedAt: -1 })
        .limit(30)
        .toArray();

      const scored: { content: string; role: string; agentUsed?: string; timestamp: Date; score: number }[] = [];

      for (const doc of docs) {
        for (const turn of (doc.turns as ConversationTurn[]) ?? []) {
          if (!turn.embedding || !turn.content) continue;
          const score = cosineSimilarity(queryEmbedding, turn.embedding);
          if (score >= SIMILARITY_THRESHOLD) {
            scored.push({
              content: turn.content,
              role: turn.role,
              agentUsed: turn.agentUsed,
              timestamp: turn.timestamp,
              score,
            });
          }
        }
      }

      if (scored.length > 0) {
        return scored.sort((a, b) => b.score - a.score).slice(0, limit);
      }
    }

    // No embedding or no vector matches — text fallback
    return await fallbackTextSearch(db, userId, query, limit);
  } catch {
    return inMemoryTextSearch(userId, query, limit);
  }
}

// ── Fallback: keyword match when embeddings are unavailable ──────
async function fallbackTextSearch(
  db: any,
  userId: string,
  query: string,
  limit: number
) {
  const stopWords = new Set(["the","and","for","that","this","with","was","what","how","are","has","have","been","from","they","them","their","your","about","last","time","when","where","which","will","would","could","should","does","also","just","more","some","other","than","then","into","only","over","such","after","before","between","each","during"]);
  const keywords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w));
  if (keywords.length === 0) return [];

  const docs = await db
    .collection(COLLECTIONS.conversations)
    .find({ userId })
    .sort({ updatedAt: -1 })
    .limit(20)
    .toArray();

  const matches: { content: string; role: string; agentUsed?: string; timestamp: Date; score: number }[] = [];

  for (const doc of docs) {
    for (const turn of (doc.turns as ConversationTurn[]) ?? []) {
      const text = turn.content.toLowerCase();
      const matchCount = keywords.filter(k => text.includes(k)).length;
      if (matchCount >= Math.max(1, Math.floor(keywords.length * 0.3))) {
        matches.push({
          content: turn.content,
          role: turn.role,
          agentUsed: turn.agentUsed,
          timestamp: turn.timestamp,
          score: matchCount / keywords.length,
        });
      }
    }
  }

  return matches.sort((a, b) => b.score - a.score).slice(0, limit);
}

// ── Fallback: keyword search over in-memory store ────────────────
function inMemoryTextSearch(
  userId: string,
  query: string,
  limit: number
): { content: string; role: string; agentUsed?: string; timestamp: Date; score: number }[] {
  const stopWords = new Set(["the","and","for","that","this","with","was","what","how","are","has","have","been","from","they","them","their","your","about","last","time","when","where","which","will","would","could","should","does","also","just","more","some","other","than","then","into","only","over","such","after","before","between","each","during"]);
  const keywords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w));
  if (keywords.length === 0) return [];

  const matches: { content: string; role: string; agentUsed?: string; timestamp: Date; score: number }[] = [];

  for (const doc of inMemoryStore.values()) {
    if (doc.userId !== userId) continue;
    for (const turn of doc.turns) {
      const text = turn.content.toLowerCase();
      const matchCount = keywords.filter(k => text.includes(k)).length;
      if (matchCount >= Math.max(1, Math.floor(keywords.length * 0.3))) {
        matches.push({
          content: turn.content,
          role: turn.role,
          agentUsed: turn.agentUsed,
          timestamp: turn.timestamp,
          score: matchCount / keywords.length,
        });
      }
    }
  }

  return matches.sort((a, b) => b.score - a.score).slice(0, limit);
}

// ── Build LLM context from memory ─────────────────────────────────
// Combines: recent session turns + recalled past memory into a prompt-ready format
export async function buildConversationContext(
  sessionId: string,
  userId: string,
  currentMessage: string
): Promise<{ role: "user" | "assistant" | "system"; content: string }[]> {
  // 1. Get recent turns from THIS session (short-term memory)
  const recentTurns = await getRecentTurns(sessionId, 8);

  // 2. Recall relevant turns from ALL past sessions (long-term memory)
  const pastMemory = await recallRelevantMemory(userId, currentMessage, 4);

  // 3. Build the context array
  const context: { role: "user" | "assistant" | "system"; content: string }[] = [];

  // Inject recalled memory as system context
  if (pastMemory.length > 0) {
    const memoryBlock = pastMemory
      .map(m => `[${m.role}${m.agentUsed ? ` via ${m.agentUsed}` : ""}]: ${m.content}`)
      .join("\n");

    context.push({
      role: "system",
      content: `Relevant context from past conversations:\n${memoryBlock}\n\nUse this context naturally — don't repeat it verbatim, but reference it if the user's question relates to it.`,
    });
  }

  // Add recent session turns
  for (const turn of recentTurns) {
    context.push({
      role: turn.role,
      content: turn.content,
    });
  }

  return context;
}
