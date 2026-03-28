import { COLLECTIONS, getDb } from "@/lib/mongodb";

export async function POST(req: Request) {
  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (payload?.type === "url_verification") {
    return Response.json({ challenge: payload.challenge ?? "" });
  }

  if (payload?.type === "event_callback" && payload?.event?.type === "message") {
    const event = payload.event;
    const db = await getDb();
    await db.collection(COLLECTIONS.messages).updateOne(
      { id: event.ts },
      {
        $set: {
          id: event.ts,
          ts: event.ts,
          channel: event.channel ?? "",
          user: event.user ?? "",
          text: event.text ?? "",
          source: "slack",
          updatedAt: new Date(),
        },
        $setOnInsert: {
          createdAt: new Date(),
        },
      },
      { upsert: true }
    );
  }

  return Response.json({ ok: true });
}

