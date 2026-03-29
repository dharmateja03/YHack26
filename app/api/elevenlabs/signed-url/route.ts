import { NextResponse } from "next/server";

export async function GET() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const agentId =
    process.env.ELEVENLABS_CONVAI_AGENT_ID ??
    process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID;

  if (!agentId) {
    return NextResponse.json(
      {
        error: "Missing ELEVENLABS_CONVAI_AGENT_ID",
      },
      { status: 400 }
    );
  }

  if (!apiKey) {
    return NextResponse.json(
      {
        signedUrl: null,
        agentId,
        fallback: true,
        warning: "ELEVENLABS_API_KEY missing; using direct agent connection.",
      },
      {
        status: 200,
        headers: { "Cache-Control": "no-store" },
      }
    );
  }

  try {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(agentId)}`,
      {
        headers: { "xi-api-key": apiKey },
      }
    );

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const status = res.status;

      // Some keys don't have `convai_write`; fall back to direct agent connection.
      if (
        status === 401 ||
        status === 403 ||
        body.includes("missing_permissions")
      ) {
        return NextResponse.json(
          {
            signedUrl: null,
            agentId,
            fallback: true,
            warning: "Signed URL unavailable for this key; using direct agent connection.",
            details: body || res.statusText,
          },
          {
            status: 200,
            headers: { "Cache-Control": "no-store" },
          }
        );
      }

      return NextResponse.json(
        { error: "Failed to generate signed URL", details: body || res.statusText },
        { status: 502 }
      );
    }

    const data = (await res.json()) as { signed_url?: string };
    if (!data.signed_url) {
      return NextResponse.json(
        { error: "No signed_url in ElevenLabs response" },
        { status: 502 }
      );
    }

    return NextResponse.json(
      {
        signedUrl: data.signed_url,
        agentId,
        fallback: false,
      },
      {
        status: 200,
        headers: { "Cache-Control": "no-store" },
      }
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: "Signed URL request failed", details: error?.message ?? "unknown" },
      { status: 500 }
    );
  }
}
