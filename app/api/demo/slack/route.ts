import { NextResponse } from "next/server";
import { COLLECTIONS, getDb } from "@/lib/mongodb";

type SlackPostBody = {
  channel?: string;
  text?: string;
  threadTs?: string;
  teamId?: string;
  author?: string;
};

export async function POST(req: Request): Promise<NextResponse> {
  let body: SlackPostBody;
  try {
    body = (await req.json()) as SlackPostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const channel = body.channel?.trim();
  const text = body.text?.trim();
  if (!channel || !text) {
    return NextResponse.json(
      { error: "channel and text are required" },
      { status: 400 }
    );
  }

  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "SLACK_BOT_TOKEN is not configured" },
      { status: 500 }
    );
  }

  let slackData: any;
  try {
    const slackRes = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channel,
        text,
        ...(body.threadTs ? { thread_ts: body.threadTs } : {}),
      }),
    });

    slackData = await slackRes.json();
    if (!slackData?.ok) {
      return NextResponse.json(
        { error: "Slack post failed", details: slackData },
        { status: 502 }
      );
    }
  } catch (error: any) {
    return NextResponse.json(
      { error: "Slack request failed", details: error?.message ?? "unknown" },
      { status: 502 }
    );
  }

  try {
    const messageId = String(slackData.ts ?? Date.now());
    const db = await getDb();
    await db.collection(COLLECTIONS.messages).updateOne(
      { messageId },
      {
        $set: {
          messageId,
          channelId: channel,
          author: body.author ?? "demo-api",
          text,
          mentions: [],
          threadId: body.threadTs ?? messageId,
          teamId: body.teamId ?? "team-1",
          createdAt: new Date(),
          source: "demo-slack-api",
        },
      },
      { upsert: true }
    );
  } catch {
    // Slack succeeded; DB sync failure should not block client response.
  }

  return NextResponse.json({
    ok: true,
    channel,
    ts: slackData.ts,
    text,
  });
}
