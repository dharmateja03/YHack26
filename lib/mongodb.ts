import { randomUUID } from "crypto";
import { getSqliteDbSafe, SqliteDb } from "@/lib/sqlite";

type JsonDoc = Record<string, any>;
type Filter = Record<string, any>;
type SortSpec = Record<string, 1 | -1>;

type FindCursor = {
  sort: (spec: SortSpec) => FindCursor;
  limit: (n: number) => FindCursor;
  next: () => Promise<JsonDoc | null>;
  toArray: () => Promise<JsonDoc[]>;
};

type SqliteCollection = {
  find: (filter?: Filter) => FindCursor;
  findOne: (filter?: Filter, options?: { sort?: SortSpec }) => Promise<JsonDoc | null>;
  insertOne: (doc: JsonDoc) => Promise<{ insertedId: string }>;
  insertMany: (docs: JsonDoc[]) => Promise<{ insertedCount: number }>;
  updateOne: (
    filter: Filter,
    update: { $set?: JsonDoc; $setOnInsert?: JsonDoc; $inc?: Record<string, number>; $push?: JsonDoc },
    options?: { upsert?: boolean }
  ) => Promise<{ matchedCount: number; modifiedCount: number; upsertedCount: number; upsertedId?: string }>;
  countDocuments: (filter?: Filter) => Promise<number>;
  deleteMany: (filter?: Filter) => Promise<{ deletedCount: number }>;
  bulkWrite: (ops: Array<{ updateOne?: { filter: Filter; update: any; upsert?: boolean } }>) => Promise<{ modifiedCount: number; upsertedCount: number }>;
  aggregate: (pipeline: any[]) => { toArray: () => Promise<JsonDoc[]> };
};

type SqliteDbAdapter = {
  collection: <T = any>(name: string) => any;
};

type GlobalState = {
  __sqliteAdapterPromise?: Promise<SqliteDbAdapter>;
};

const globalState = globalThis as typeof globalThis & GlobalState;

const ID_FIELDS: Record<string, string> = {
  prs: "prId",
  tickets: "ticketId",
  messages: "messageId",
  calendars: "eventId",
  sprints: "sprintId",
  conversations: "sessionId",
  users: "userId",
  organizations: "orgId",
  org_members: "userId",
  org_invites: "token",
  negotiations: "negotiationId",
};

function ensureStoreSchema(db: SqliteDb) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS docs (
      collection TEXT NOT NULL,
      doc_id TEXT NOT NULL,
      doc_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (collection, doc_id)
    );
    CREATE INDEX IF NOT EXISTS idx_docs_collection ON docs(collection);
  `);
}

function stableClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function isDateLike(v: unknown): boolean {
  if (v instanceof Date) return true;
  if (typeof v !== "string") return false;
  const t = Date.parse(v);
  return Number.isFinite(t);
}

function toComparable(v: unknown): any {
  if (v instanceof Date) return v.getTime();
  if (typeof v === "string" && isDateLike(v)) return new Date(v).getTime();
  return v;
}

function compareValues(a: unknown, b: unknown): number {
  const av = toComparable(a);
  const bv = toComparable(b);
  if (av === bv) return 0;
  if (av == null) return 1;
  if (bv == null) return -1;
  return av < bv ? -1 : 1;
}

function matchesCondition(value: unknown, cond: unknown): boolean {
  if (cond && typeof cond === "object" && !Array.isArray(cond)) {
    const obj = cond as Record<string, unknown>;
    if ("$in" in obj && Array.isArray(obj.$in)) {
      return obj.$in.some((x) => compareValues(value, x) === 0);
    }
    if ("$ne" in obj) {
      return compareValues(value, obj.$ne) !== 0;
    }
    if ("$gt" in obj) {
      return compareValues(value, obj.$gt) > 0;
    }
    if ("$gte" in obj) {
      return compareValues(value, obj.$gte) >= 0;
    }
    if ("$lt" in obj) {
      return compareValues(value, obj.$lt) < 0;
    }
    if ("$lte" in obj) {
      return compareValues(value, obj.$lte) <= 0;
    }
  }
  return compareValues(value, cond) === 0;
}

function matchesFilter(doc: JsonDoc, filter?: Filter): boolean {
  if (!filter || Object.keys(filter).length === 0) return true;
  for (const [key, cond] of Object.entries(filter)) {
    if (!matchesCondition(doc[key], cond)) return false;
  }
  return true;
}

function applySort(rows: JsonDoc[], spec?: SortSpec): JsonDoc[] {
  if (!spec || Object.keys(spec).length === 0) return rows;
  const keys = Object.keys(spec);
  return rows.sort((a, b) => {
    for (const k of keys) {
      const dir = spec[k] === -1 ? -1 : 1;
      const cmp = compareValues(a[k], b[k]);
      if (cmp !== 0) return dir * cmp;
    }
    return 0;
  });
}

function getIdField(collection: string): string {
  return ID_FIELDS[collection] || "_id";
}

function docIdFor(collection: string, doc: JsonDoc): string {
  if (collection === "calendars") {
    const eventId = String(doc.eventId ?? "");
    const userId = String(doc.userId ?? "");
    if (eventId && userId) return `${eventId}:${userId}`;
  }
  const idField = getIdField(collection);
  let id = doc[idField] ? String(doc[idField]) : "";
  if (!id) {
    id = randomUUID().replace(/-/g, "");
    doc[idField] = id;
  }
  return id;
}

function createCollection(db: SqliteDb, name: string): SqliteCollection {
  const readAll = (): JsonDoc[] => {
    const rows = db
      .prepare("SELECT doc_json FROM docs WHERE collection = ?")
      .all(name) as Array<{ doc_json: string }>;
    return rows
      .map((r) => {
        try {
          return JSON.parse(r.doc_json) as JsonDoc;
        } catch {
          return null;
        }
      })
      .filter((x): x is JsonDoc => Boolean(x));
  };

  const saveOne = (doc: JsonDoc) => {
    const id = docIdFor(name, doc);
    db.prepare(
      `INSERT INTO docs (collection, doc_id, doc_json, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(collection, doc_id) DO UPDATE SET
         doc_json = excluded.doc_json,
         updated_at = excluded.updated_at`
    ).run(name, id, JSON.stringify(doc), new Date().toISOString());
    return id;
  };

  const find = (filter: Filter = {}) => {
    let sortSpec: SortSpec | undefined;
    let limitCount = Infinity;

    const cursor: FindCursor = {
      sort(spec: SortSpec) {
        sortSpec = spec;
        return cursor;
      },
      limit(n: number) {
        limitCount = Math.max(0, Number(n) || 0);
        return cursor;
      },
      async toArray() {
        const all = readAll().filter((d) => matchesFilter(d, filter));
        const sorted = applySort(all, sortSpec);
        const limited = Number.isFinite(limitCount) ? sorted.slice(0, limitCount) : sorted;
        return stableClone(limited);
      },
      async next() {
        const rows = await cursor.limit(1).toArray();
        return rows[0] ?? null;
      },
    };
    return cursor;
  };

  return {
    find,
    async findOne(filter: Filter = {}, options?: { sort?: SortSpec }) {
      const rows = await find(filter).sort(options?.sort || {}).limit(1).toArray();
      return rows[0] ?? null;
    },
    async insertOne(doc: JsonDoc) {
      const copy = stableClone(doc);
      const insertedId = saveOne(copy);
      return { insertedId };
    },
    async insertMany(docs: JsonDoc[]) {
      for (const doc of docs) saveOne(stableClone(doc));
      return { insertedCount: docs.length };
    },
    async updateOne(
      filter: Filter,
      update: { $set?: JsonDoc; $setOnInsert?: JsonDoc; $inc?: Record<string, number>; $push?: JsonDoc },
      options?: { upsert?: boolean }
    ) {
      const current = await find(filter).limit(1).toArray();
      let target = current[0] ? stableClone(current[0]) : null;
      let matchedCount = target ? 1 : 0;
      let upsertedCount = 0;
      let upsertedId: string | undefined;

      if (!target && options?.upsert) {
        target = {};
        for (const [k, v] of Object.entries(filter || {})) {
          if (v && typeof v === "object" && !Array.isArray(v)) continue;
          target[k] = v;
        }
        if (update.$setOnInsert) Object.assign(target, stableClone(update.$setOnInsert));
        matchedCount = 0;
        upsertedCount = 1;
      }

      if (!target) {
        return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
      }

      if (update.$set) Object.assign(target, stableClone(update.$set));
      if (update.$inc) {
        for (const [k, v] of Object.entries(update.$inc)) {
          const prev = Number(target[k] ?? 0);
          target[k] = prev + Number(v ?? 0);
        }
      }
      if (update.$push) {
        for (const [k, v] of Object.entries(update.$push)) {
          if (!Array.isArray(target[k])) target[k] = [];
          target[k].push(stableClone(v));
        }
      }

      upsertedId = saveOne(target);
      return {
        matchedCount,
        modifiedCount: 1,
        upsertedCount,
        upsertedId: upsertedCount ? upsertedId : undefined,
      };
    },
    async countDocuments(filter: Filter = {}) {
      return readAll().filter((d) => matchesFilter(d, filter)).length;
    },
    async deleteMany(filter: Filter = {}) {
      const all = readAll();
      const toDelete = all.filter((d) => matchesFilter(d, filter));
      for (const doc of toDelete) {
        const id = docIdFor(name, doc);
        db.prepare("DELETE FROM docs WHERE collection = ? AND doc_id = ?").run(name, id);
      }
      return { deletedCount: toDelete.length };
    },
    async bulkWrite(ops: Array<{ updateOne?: { filter: Filter; update: any; upsert?: boolean } }>) {
      let modifiedCount = 0;
      let upsertedCount = 0;
      for (const op of ops) {
        const u = op.updateOne;
        if (!u) continue;
        const res = await this.updateOne(u.filter, u.update ?? {}, { upsert: u.upsert });
        modifiedCount += res.modifiedCount;
        upsertedCount += res.upsertedCount;
      }
      return { modifiedCount, upsertedCount };
    },
    aggregate(pipeline: any[]) {
      const run = async () => {
        if (pipeline.some((stage) => "$vectorSearch" in stage)) return [] as JsonDoc[];
        let rows = readAll();
        for (const stage of pipeline) {
          if (stage.$match) rows = rows.filter((d) => matchesFilter(d, stage.$match));
          if (stage.$project) {
            rows = rows.map((d) => {
              const out: JsonDoc = {};
              for (const [k, v] of Object.entries(stage.$project)) {
                if (v === 1) out[k] = d[k];
                else if (typeof v === "string" && v.startsWith("$")) out[k] = d[v.slice(1)];
              }
              return out;
            });
          }
          if (typeof stage.$limit === "number") rows = rows.slice(0, stage.$limit);
          if (stage.$sort) rows = applySort(rows, stage.$sort);
        }
        return stableClone(rows);
      };
      return { toArray: run };
    },
  };
}

async function createDbAdapter(): Promise<SqliteDbAdapter> {
  const sqlite = await getSqliteDbSafe();
  if (!sqlite) throw new Error("db_unavailable");
  ensureStoreSchema(sqlite);
  return {
    collection<T = JsonDoc>(name: string) {
      return createCollection(sqlite, name);
    },
  };
}

export async function getDb(): Promise<SqliteDbAdapter> {
  if (!globalState.__sqliteAdapterPromise) {
    globalState.__sqliteAdapterPromise = createDbAdapter();
  }
  return globalState.__sqliteAdapterPromise;
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
  conversations: "conversations",
  emails: "emails",
  users: "users",
  organizations: "organizations",
  orgMembers: "org_members",
  orgInvites: "org_invites",
  negotiations: "negotiations",
} as const;
