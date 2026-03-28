import { MongoClient, Db } from "mongodb";

let client: MongoClient;
let db: Db;

export async function getDb(): Promise<Db> {
  if (db) return db;
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set");
  const dbName = process.env.MONGODB_DB ?? "neosis";
  if (!client) {
    client = new MongoClient(uri);
    await client.connect();
  }
  db = client.db(dbName);
  return db;
}

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
