import dotenv from "dotenv";
import axios from "axios";
import { resolve, dirname } from "path";
import { mkdirSync } from "fs";

dotenv.config({ path: ".env.local" });
dotenv.config();

const COLLECTIONS = {
  prs: "prs",
  tickets: "tickets",
  messages: "messages",
};

const VOYAGE_API_URL = "https://api.voyageai.com/v1/embeddings";
const VOYAGE_MODEL = "voyage-code-2";

function parseLimitArg() {
  const idx = process.argv.findIndex((a) => a === "--limit");
  if (idx === -1) return 500;
  const v = Number(process.argv[idx + 1]);
  if (!Number.isFinite(v) || v <= 0) return 500;
  return Math.floor(v);
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function isPineconeConfigured() {
  return Boolean(process.env.PINECONE_API_KEY?.trim() && process.env.PINECONE_INDEX_HOST?.trim());
}

function getPineconeHost() {
  const host = process.env.PINECONE_INDEX_HOST?.trim();
  if (!host) return null;
  return host.startsWith("http://") || host.startsWith("https://") ? host : `https://${host}`;
}

async function upsertPineconeVectors(vectors) {
  const host = getPineconeHost();
  if (!host || vectors.length === 0) return;

  await fetch(`${host}/vectors/upsert`, {
    method: "POST",
    headers: {
      "Api-Key": process.env.PINECONE_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      vectors,
      namespace: process.env.PINECONE_NAMESPACE || "neosis",
    }),
  });
}

async function embedBatch(texts) {
  if (texts.length === 0) return [];
  const response = await axios.post(
    VOYAGE_API_URL,
    { input: texts, model: VOYAGE_MODEL },
    {
      headers: {
        Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
        "Content-Type": "application/json",
      },
    }
  );
  return response.data.data.map((item) => item.embedding);
}

function toText(collection, doc) {
  if (collection === COLLECTIONS.messages) return String(doc.text ?? "");
  if (collection === COLLECTIONS.tickets) return `${doc.title ?? ""} ${doc.description ?? ""}`.trim();
  if (collection === COLLECTIONS.prs) return `${doc.title ?? ""} ${doc.body ?? ""}`.trim();
  return "";
}

function getId(collection, doc) {
  if (collection === COLLECTIONS.messages) return String(doc.messageId ?? "");
  if (collection === COLLECTIONS.tickets) return String(doc.ticketId ?? "");
  if (collection === COLLECTIONS.prs) return String(doc.prId ?? "");
  return "";
}

function parseEmbedding(value) {
  if (Array.isArray(value)) return value;
  if (!value) return null;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

function getSqlitePath() {
  const sqliteDbPath = process.env.SQLITE_DB_PATH?.trim();
  if (sqliteDbPath) return resolve(process.cwd(), sqliteDbPath);

  const sqlitePath = process.env.SQLITE_PATH?.trim();
  if (sqlitePath) return resolve(process.cwd(), sqlitePath);

  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (databaseUrl?.startsWith("file:")) {
    const raw = databaseUrl.slice("file:".length);
    if (raw.startsWith("/")) return raw;
    return resolve(process.cwd(), raw);
  }

  return resolve(process.cwd(), ".data/neosis.sqlite");
}

async function openSqlite() {
  const path = getSqlitePath();
  try {
    mkdirSync(dirname(path), { recursive: true });
    const mod = await import("better-sqlite3");
    const BetterSqlite = mod.default ?? mod;
    return new BetterSqlite(path, {});
  } catch (err) {
    try {
      const sqliteImporter = new Function('return import("node:sqlite")');
      const sqliteMod = await sqliteImporter();
      const DatabaseSync = sqliteMod.DatabaseSync;
      mkdirSync(dirname(path), { recursive: true });
      return new DatabaseSync(path);
    } catch (err2) {
      return {
        __error: `open sqlite failed for ${path}. better-sqlite3: ${err?.message || err}; node:sqlite fallback: ${err2?.message || err2}`,
      };
    }
  }
}

function fetchSqliteDocs(sqlite, collection, limit) {
  try {
    if (collection === COLLECTIONS.messages) {
      return sqlite
        .prepare(
          "SELECT message_id AS messageId, team_id AS teamId, text, embedding_json AS embeddingJson FROM messages ORDER BY created_at DESC LIMIT ?"
        )
        .all(limit);
    }
    if (collection === COLLECTIONS.tickets) {
      return sqlite
        .prepare(
          "SELECT ticket_id AS ticketId, team_id AS teamId, title, description, embedding_json AS embeddingJson FROM tickets ORDER BY updated_at DESC LIMIT ?"
        )
        .all(limit);
    }
    if (collection === COLLECTIONS.prs) {
      return sqlite
        .prepare(
          "SELECT pr_id AS prId, team_id AS teamId, title, body, embedding_json AS embeddingJson FROM prs ORDER BY updated_at DESC LIMIT ?"
        )
        .all(limit);
    }
    return [];
  } catch {
    return [];
  }
}

async function run() {
  const limit = parseLimitArg();

  if (!process.env.VOYAGE_API_KEY?.trim()) throw new Error("VOYAGE_API_KEY missing");
  if (!isPineconeConfigured()) throw new Error("PINECONE_API_KEY/PINECONE_INDEX_HOST missing");

  const sqlite = await openSqlite();
  if (!sqlite || sqlite.__error) {
    if (sqlite?.__error) console.warn(sqlite.__error);
    console.warn("No data source available (SQLite unavailable).");
    console.log("pinecone sync complete, total upserted: 0");
    return;
  }
  console.log(`sync source: sqlite (${getSqlitePath()})`);

  const collections = [COLLECTIONS.messages, COLLECTIONS.tickets, COLLECTIONS.prs];
  let totalUpserted = 0;

  for (const name of collections) {
    const docs = fetchSqliteDocs(sqlite, name, limit);
    const normalized = docs
      .map((d) => {
        const id = getId(name, d);
        const text = toText(name, d);
        const teamId = String(d.teamId ?? "team-1");
        const embedding = parseEmbedding(d.embedding ?? d.embeddingJson);
        return { id, text, teamId, embedding };
      })
      .filter((d) => d.id && d.text);

    const withoutEmbedding = normalized.filter((d) => !d.embedding);
    for (const batch of chunk(withoutEmbedding, 32)) {
      try {
        const vectors = await embedBatch(batch.map((x) => x.text));
        batch.forEach((item, i) => {
          item.embedding = vectors[i];
        });
      } catch (err) {
        console.warn(`embedding failed for ${name} batch: ${err?.message || err}`);
      }
    }

    const pineVectors = normalized
      .filter((d) => Array.isArray(d.embedding))
      .map((d) => ({
        id: `${name}:${d.id}`,
        values: d.embedding,
        metadata: {
          source: name,
          docId: d.id,
          teamId: d.teamId,
          text: d.text.slice(0, 2000),
        },
      }));

    for (const batch of chunk(pineVectors, 100)) {
      await upsertPineconeVectors(batch);
      totalUpserted += batch.length;
    }

    console.log(`synced ${name}: ${pineVectors.length}`);
  }

  if (sqlite?.close) sqlite.close();
  console.log(`pinecone sync complete, total upserted: ${totalUpserted}`);
}

run().catch((err) => {
  console.error("sync-pinecone failed:", err?.message || err);
  process.exit(1);
});
