import { spawn } from "child_process";

type TimeSlot = { start: string; end: string };
type BusyBlock = { start: string; end: string };

export interface HermesScheduleInput {
  participantIds: string[];
  durationMins: number;
  preferredTime?: string;
  busyBlocks: BusyBlock[];
}

function extractJson(raw: string): unknown | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    // Fall through.
  }

  const fenced = trimmed.match(/```json\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      // Fall through.
    }
  }

  const objectMatch = trimmed.match(/\{[\s\S]*\}/);
  if (objectMatch?.[0]) {
    try {
      return JSON.parse(objectMatch[0]);
    } catch {
      return null;
    }
  }

  return null;
}

function toIsoOrNull(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function toTimeSlotOrNull(parsed: unknown): TimeSlot | null {
  if (!parsed || typeof parsed !== "object") return null;
  const maybe = parsed as Record<string, unknown>;

  const start = toIsoOrNull(maybe.start);
  const end = toIsoOrNull(maybe.end);
  if (!start || !end) return null;

  if (new Date(end).getTime() <= new Date(start).getTime()) return null;
  return { start, end };
}

function buildPrompt(input: HermesScheduleInput): string {
  return [
    "You are Hermes, an agent-to-agent scheduling subagent.",
    "Find one mutually free slot for all participants.",
    'Return STRICT JSON ONLY: {"start":"ISO8601","end":"ISO8601","reason":"string","confidence":0..1}.',
    'If no slot is available, return {"start":null,"end":null,"reason":"no slot","confidence":0}.',
    `participants=${JSON.stringify(input.participantIds)}`,
    `durationMins=${input.durationMins}`,
    `preferredTime=${input.preferredTime ?? "none"}`,
    `busyBlocks=${JSON.stringify(input.busyBlocks)}`,
  ].join("\n");
}

async function runHermes(prompt: string): Promise<string | null> {
  const command = process.env.HERMES_COMMAND ?? "hermes";
  const timeoutMs = Number(process.env.HERMES_TIMEOUT_MS ?? 20_000);

  const args = ["chat", "-q", prompt];
  if (process.env.HERMES_PROVIDER) args.push("--provider", process.env.HERMES_PROVIDER);
  if (process.env.HERMES_MODEL) args.push("--model", process.env.HERMES_MODEL);

  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(null);
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", () => {
      clearTimeout(timer);
      finish(null);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        const maybeOutput = `${stdout}\n${stderr}`.trim();
        finish(maybeOutput.length > 0 ? maybeOutput : null);
        return;
      }
      finish(stdout.trim() || null);
    });
  });
}

export async function findMutualSlotWithHermes(
  input: HermesScheduleInput
): Promise<TimeSlot | null> {
  if (process.env.HERMES_ENABLED !== "true") return null;

  const raw = await runHermes(buildPrompt(input));
  if (!raw) return null;

  const parsed = extractJson(raw);
  return toTimeSlotOrNull(parsed);
}

