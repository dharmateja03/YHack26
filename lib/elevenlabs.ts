const ELEVENLABS_BASE_URL = "https://api.elevenlabs.io/v1";

/**
 * Streams text-to-speech audio from ElevenLabs.
 * Returns a raw ReadableStream of audio/mpeg chunks — does NOT buffer the full file.
 * Chunks stream back to the browser as they arrive (~300ms to first word).
 *
 * @param text - The spoken script to synthesize (max ~5000 chars for turbo model)
 * @returns ReadableStream of audio/mpeg binary data
 */
export async function streamSpeech(text: string): Promise<ReadableStream<Uint8Array>> {
  const voiceId =
    process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error("ELEVENLABS_API_KEY environment variable is not set");
  }

  const url = `${ELEVENLABS_BASE_URL}/text-to-speech/${voiceId}/stream`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: "eleven_turbo_v2",
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0.0,
        use_speaker_boost: true,
      },
      // Optimize for low latency streaming
      optimize_streaming_latency: 3,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    throw new Error(
      `ElevenLabs API error ${response.status}: ${errorText}`
    );
  }

  if (!response.body) {
    throw new Error("ElevenLabs returned an empty response body");
  }

  return response.body;
}
