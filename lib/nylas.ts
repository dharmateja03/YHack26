// Nylas v3 API helper

const NYLAS_BASE = "https://api.us.nylas.com";

function getApiKey(): string {
  const key = process.env.NYLAS_API_KEY?.trim();
  if (!key) throw new Error("NYLAS_API_KEY is not set");
  return key;
}

function getGrantId(): string {
  const grantId = process.env.NYLAS_GRANT_ID?.trim();
  if (!grantId) throw new Error("NYLAS_GRANT_ID is not set. Get it from the Nylas dashboard → Grants.");
  return grantId;
}

export interface NylasEvent {
  title: string;
  startTime: number; // unix timestamp
  endTime: number;   // unix timestamp
  attendeeEmails: string[];
  description?: string;
  calendarId?: string; // defaults to "primary"
}

export interface NylasEventResult {
  id: string;
  title: string;
  start: string;
  end: string;
  htmlLink?: string;
}

export async function createNylasEvent(event: NylasEvent): Promise<NylasEventResult> {
  const apiKey = getApiKey();
  const grantId = getGrantId();
  const calendarId = event.calendarId ?? "primary";

  const body = {
    title: event.title,
    description: event.description ?? "",
    when: {
      start_time: event.startTime,
      end_time: event.endTime,
    },
    participants: event.attendeeEmails.map((email) => ({
      email,
      status: "noreply",
    })),
  };

  const res = await fetch(
    `${NYLAS_BASE}/v3/grants/${encodeURIComponent(grantId)}/events?calendar_id=${encodeURIComponent(calendarId)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Nylas event creation failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { data: any };
  const ev = data.data;

  return {
    id: ev.id,
    title: ev.title,
    start: new Date((ev.when?.start_time ?? 0) * 1000).toISOString(),
    end: new Date((ev.when?.end_time ?? 0) * 1000).toISOString(),
    htmlLink: ev.html_link,
  };
}
