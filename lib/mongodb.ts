import { MongoClient, Db } from "mongodb";

const uri = process.env.MONGODB_URI!;
const dbName = process.env.MONGODB_DB || "neosis";

export const COLLECTIONS = {
  prs: "prs",
  tickets: "tickets",
  messages: "messages",
  calendars: "calendars",
  briefs: "briefs",
  sprints: "sprints",
  agents: "agents",
  preferences: "preferences",
} as const;

let client: MongoClient | null = null;
let db: Db | null = null;

export async function getDb(): Promise<Db> {
  if (db) return db;

  if (!client) {
    client = new MongoClient(uri);
    await client.connect();
  }

  db = client.db(dbName);
  return db;
}
