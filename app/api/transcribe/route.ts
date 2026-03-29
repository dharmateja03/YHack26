import { NextRequest, NextResponse } from "next/server";

const ELEVENLABS_STT_URL = "https://api.elevenlabs.io/v1/speech-to-text";

export async function POST(req: NextRequest) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "STT not configured" }, { status: 500 });
  }

  try {
    const formData = await req.formData();
    const audioFile = formData.get("audio") as File | null;
    if (!audioFile) {
      return NextResponse.json({ error: "No audio file" }, { status: 400 });
    }

    const body = new FormData();
    body.append("file", audioFile, audioFile.name || "recording.webm");
    body.append("model_id", "scribe_v2");

    const res = await fetch(ELEVENLABS_STT_URL, {
      method: "POST",
      headers: { "xi-api-key": apiKey },
      body,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      console.error("[transcribe] ElevenLabs STT error:", res.status, errText);
      return NextResponse.json({ error: "Transcription failed" }, { status: 502 });
    }

    const data = await res.json();
    return NextResponse.json({ text: data.text ?? "" });
  } catch (e) {
    console.error("[transcribe] Unexpected error:", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
