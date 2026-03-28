// Nylas webhook handler — calendar event ingestion
// Receives: event.created | event.updated | event.deleted per user
// Upserts into neosis.calendars collection

interface NylasParticipant {
  email: string;
  name?: string;
}

interface NylasWhen {
  start_time: number;
  end_time: number;
}

interface NylasEventObject {
  id: string;
  account_id: string;
  title?: string;
  when: NylasWhen;
  participants?: NylasParticipant[];
}

interface NylasWebhookPayload {
  type: "event.created" | "event.updated" | "event.deleted";
  data: {
    object: NylasEventObject;
  };
}

async function getCalendarsCollection() {
  try {
    if (!process.env.MONGODB_URI) return null;
    const { MongoClient } = await import("mongodb");
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    return client
      .db(process.env.MONGODB_DB ?? "neosis")
      .collection("calendars");
  } catch {
    return null;
  }
}

// In-memory fallback for tests/dev without MongoDB
const inMemoryStore: Map<string, object> = new Map();

export async function POST(req: Request) {
  let payload: NylasWebhookPayload;
  try {
    payload = await req.json();
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  const { type, data } = payload;
  if (!data?.object) {
    return new Response("OK", { status: 200 });
  }

  const obj = data.object;
  const eventDoc = {
    eventId: obj.id,
    userId: obj.account_id,
    title: obj.title ?? "Untitled",
    start: new Date(obj.when.start_time * 1000).toISOString(),
    end: new Date(obj.when.end_time * 1000).toISOString(),
    attendees: (obj.participants ?? []).map((p) => p.email),
    createdAt: new Date().toISOString(),
  };

  const col = await getCalendarsCollection();
  if (col) {
    if (type === "event.deleted") {
      await col.deleteOne({ eventId: obj.id });
    } else {
      await col.updateOne(
        { eventId: obj.id },
        { $set: eventDoc },
        { upsert: true }
      );
    }
  } else {
    // In-memory fallback
    if (type === "event.deleted") {
      inMemoryStore.delete(obj.id);
    } else {
      inMemoryStore.set(obj.id, eventDoc);
    }
  }

  return new Response("OK", { status: 200 });
}
