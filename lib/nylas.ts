/**
 * Nylas v3 API helpers.
 *
 * All calls go through https://api.us.nylas.com/v3/grants/{grantId}/...
 * Requires NYLAS_API_KEY and NYLAS_GRANT_ID env vars.
 */

const NYLAS_BASE = "https://api.us.nylas.com/v3";

function getConfig() {
  const apiKey = process.env.NYLAS_API_KEY?.trim();
  const grantId = process.env.NYLAS_GRANT_ID?.trim();
  if (!apiKey || !grantId) return null;
  return { apiKey, grantId };
}

function headers(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

// ── Email ─────────────────────────────────────────────────────────────

export interface NylasSendEmailParams {
  to: { name?: string; email: string }[];
  subject: string;
  body: string;
  replyTo?: { name?: string; email: string }[];
  cc?: { name?: string; email: string }[];
  trackingOptions?: Record<string, unknown>;
}

export async function sendEmail(params: NylasSendEmailParams): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  const cfg = getConfig();
  if (!cfg) return { ok: false, error: "nylas_not_configured" };

  try {
    const res = await fetch(`${NYLAS_BASE}/grants/${cfg.grantId}/messages/send`, {
      method: "POST",
      headers: headers(cfg.apiKey),
      body: JSON.stringify({
        to: params.to,
        subject: params.subject,
        body: params.body,
        ...(params.replyTo ? { reply_to: params.replyTo } : {}),
        ...(params.cc ? { cc: params.cc } : {}),
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `nylas_send_failed:${res.status} ${text.slice(0, 200)}` };
    }

    const data = await res.json().catch(() => ({})) as { data?: { id?: string } };
    return { ok: true, messageId: data.data?.id };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "nylas_send_error" };
  }
}

// ── Calendar Events ───────────────────────────────────────────────────

export interface NylasCreateEventParams {
  title: string;
  startTime: Date;
  endTime: Date;
  participants: string[];
  description?: string;
  calendarId?: string;
}

export async function createEvent(params: NylasCreateEventParams): Promise<{ ok: boolean; eventId?: string; error?: string }> {
  const cfg = getConfig();
  if (!cfg) return { ok: false, error: "nylas_not_configured" };

  const calendarId = params.calendarId ?? "primary";

  try {
    const res = await fetch(
      `${NYLAS_BASE}/grants/${cfg.grantId}/events?calendar_id=${encodeURIComponent(calendarId)}`,
      {
        method: "POST",
        headers: headers(cfg.apiKey),
        body: JSON.stringify({
          title: params.title,
          description: params.description ?? "",
          when: {
            start_time: Math.floor(params.startTime.getTime() / 1000),
            end_time: Math.floor(params.endTime.getTime() / 1000),
          },
          participants: params.participants.map((email) => ({ email })),
        }),
      }
    );

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `nylas_event_failed:${res.status} ${text.slice(0, 200)}` };
    }

    const data = await res.json().catch(() => ({})) as { data?: { id?: string } };
    return { ok: true, eventId: data.data?.id };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "nylas_event_error" };
  }
}

// ── Calendar read (free/busy) ─────────────────────────────────────────

export interface NylasCalendarEvent {
  id: string;
  title?: string;
  startTime: number;
  endTime: number;
  participants: string[];
}

export async function getEvents(
  timeMin: Date,
  timeMax: Date,
  calendarId = "primary"
): Promise<{ ok: boolean; events: NylasCalendarEvent[]; error?: string }> {
  const cfg = getConfig();
  if (!cfg) return { ok: false, events: [], error: "nylas_not_configured" };

  try {
    const params = new URLSearchParams({
      calendar_id: calendarId,
      start: Math.floor(timeMin.getTime() / 1000).toString(),
      end: Math.floor(timeMax.getTime() / 1000).toString(),
      limit: "50",
    });

    const res = await fetch(
      `${NYLAS_BASE}/grants/${cfg.grantId}/events?${params}`,
      { headers: headers(cfg.apiKey) }
    );

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, events: [], error: `nylas_events_read_failed:${res.status} ${text.slice(0, 200)}` };
    }

    const body = await res.json().catch(() => ({})) as {
      data?: Array<{
        id: string;
        title?: string;
        when?: { start_time?: number; end_time?: number };
        participants?: Array<{ email?: string }>;
      }>;
    };

    const events: NylasCalendarEvent[] = (body.data ?? [])
      .filter((e) => e.when?.start_time && e.when?.end_time)
      .map((e) => ({
        id: e.id,
        title: e.title,
        startTime: e.when!.start_time!,
        endTime: e.when!.end_time!,
        participants: (e.participants ?? []).map((p) => p.email ?? "").filter(Boolean),
      }));

    return { ok: true, events };
  } catch (err: any) {
    return { ok: false, events: [], error: err?.message ?? "nylas_events_read_error" };
  }
}
