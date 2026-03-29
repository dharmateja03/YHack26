"use client";

import { useState } from "react";
import { useUser } from "@auth0/nextjs-auth0/client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import AgentCard from "@/components/AgentCard";
import VoicePlayer from "@/components/VoicePlayer";

interface AgentStatus {
  name: string;
  key: string;
  lastRun: string | null;
  status: "idle" | "running" | "error";
}

const INITIAL_AGENTS: AgentStatus[] = [
  { name: "Neo Brief",  key: "brief",  lastRun: null, status: "idle" },
  { name: "Neo PR",     key: "pr",     lastRun: null, status: "idle" },
  { name: "Neo Sched",  key: "sched",  lastRun: null, status: "idle" },
  { name: "Neo Root",   key: "root",   lastRun: null, status: "idle" },
  { name: "Neo Sprint", key: "sprint", lastRun: null, status: "idle" },
];

const DEFAULT_USER_ID = "user-1";
const DEFAULT_TEAM_ID = "team-1";

function parsePrId(text: string): string | null {
  const m = text.match(/\bpr[-\s#:]*(\d+)\b/i);
  return m ? `pr-${m[1]}` : null;
}

function parseTicketId(text: string): string | null {
  const m = text.match(/\b(?:jira|ticket)[-\s#:]*(\d+)\b/i);
  return m ? `JIRA-${m[1]}` : null;
}

function parsePreferredTime(text: string): string | undefined {
  const m = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (!m) return undefined;
  let hour = Number(m[1]);
  const minute = Number(m[2] ?? "0");
  const meridiem = m[3].toLowerCase();
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

export default function HomePage() {
  const { user, isLoading } = useUser();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !user) router.replace("/login");
  }, [user, isLoading, router]);

  const [listening, setListening] = useState(false);
  const [audioUrl, setAudioUrl]   = useState<string | null>(null);
  const [agents, setAgents]       = useState<AgentStatus[]>(INITIAL_AGENTS);
  const [lastQuery, setLastQuery] = useState<string | null>(null);

  const handleTalkToNeo = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();

    if (!("webkitSpeechRecognition" in window) && !("SpeechRecognition" in window)) {
      void routeTranscript("morning brief");
      return;
    }

    // Prompt for microphone access up front to avoid immediate recognition failures.
    try {
      if (navigator.mediaDevices?.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());
      }
    } catch {
      alert("Microphone permission is required to listen.");
      return;
    }

    let gotResult = false;

    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SR();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    setListening(true);
    recognition.onresult = async (e: any) => {
      gotResult = true;
      const t = e.results[0][0].transcript.toLowerCase();
      setLastQuery(t);
      setListening(false);
      await routeTranscript(t);
    };

    recognition.onerror = () => {
      setListening(false);
    };

    recognition.onend = () => {
      setListening(false);
    };

    try {
      recognition.start();
    } catch {
      setListening(false);
    }
  };

  const routeTranscript = async (t: string) => {
    let endpoint = "/api/agents/brief";
    let agentKey: AgentStatus["key"] = "brief";
    let payload: Record<string, unknown> = {
      userId: DEFAULT_USER_ID,
      type: t.includes("evening") ? "evening" : "morning",
    };

    if (t.includes("schedule") || t.includes("meet")) {
      endpoint = "/api/agents/schedule/find";
      agentKey = "sched";
      payload = {
        participantIds: [DEFAULT_USER_ID, "user-2"],
        durationMins: 30,
        preferredTime: parsePreferredTime(t),
      };
    } else if (t.includes("why") || t.includes("blocked") || t.includes("root")) {
      endpoint = "/api/agents/rootcause";
      agentKey = "root";
      payload = {
        prId: parsePrId(t) ?? undefined,
        ticketId: parseTicketId(t) ?? undefined,
      };
      if (!payload.prId && !payload.ticketId) payload = { prId: "pr-1" };
    } else if (t.includes("sprint") || t.includes("forecast")) {
      endpoint = "/api/agents/sprint/forecast";
      agentKey = "sprint";
      payload = { teamId: DEFAULT_TEAM_ID };
    } else if (t.includes("pr") || t.includes("pull request") || t.includes("review")) {
      endpoint = "/api/agents/pr/scan";
      agentKey = "pr";
      payload = { teamId: DEFAULT_TEAM_ID };
    }

    setAgents(prev => prev.map(a => a.key === agentKey ? { ...a, status: "running" } : a));

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "audio/mpeg" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        setAgents(prev => prev.map(a => a.key === agentKey ? {
          ...a,
          status: "error",
          lastRun: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        } : a));
        return;
      }

      setAgents(prev => prev.map(a => a.key === agentKey ? {
        ...a, status: "idle",
        lastRun: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      } : a));
      if (res.headers.get("content-type")?.includes("audio")) {
        const blob = await res.blob();
        setAudioUrl(URL.createObjectURL(blob));
      }
    } catch {
      setAgents(prev => prev.map(a => a.key === agentKey ? { ...a, status: "error" } : a));
    }
  };

  return (
    <div className="relative flex flex-col items-center justify-center min-h-[calc(100vh-65px)] px-6 pb-32 overflow-hidden">

      {/* Background grid */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(6,182,212,1) 1px, transparent 1px), linear-gradient(90deg, rgba(6,182,212,1) 1px, transparent 1px)",
          backgroundSize: "60px 60px",
        }}
      />

      {/* Radial fade from center */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_50%_40%,transparent_30%,black_100%)]" />

      {/* ── Orb ─────────────────────────────────────── */}
      <div className="relative z-10 flex items-center justify-center mb-12">
        {/* Pulse rings — hidden while listening */}
        {!listening && (
          <>
            <div className="absolute w-48 h-48 rounded-full border border-cyan-400/20 ring-1-anim" />
            <div className="absolute w-48 h-48 rounded-full border border-cyan-400/12 ring-2-anim" />
            <div className="absolute w-48 h-48 rounded-full border border-cyan-400/8  ring-3-anim" />
          </>
        )}

        <button
          type="button"
          onClick={handleTalkToNeo}
          disabled={listening}
          className={`relative z-10 w-48 h-48 rounded-full flex flex-col items-center justify-center gap-2 transition-transform duration-300
            border scanlines
            ${listening
              ? "orb-listen bg-cyan-950/30 border-cyan-400/60 cursor-not-allowed scale-95"
              : "orb-breathe bg-gradient-to-br from-zinc-900 via-black to-zinc-900 border-cyan-500/20 hover:border-cyan-400/40 hover:scale-105 active:scale-95"
            }`}
        >
          {/* Inner radial glow */}
          <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_50%_40%,rgba(6,182,212,0.08),transparent_70%)]" />

          {listening ? (
            /* Waveform bars */
            <div className="flex items-center gap-[3px] h-7">
              {[0.6, 1, 0.75, 1, 0.5, 0.85, 0.65].map((h, i) => (
                <div
                  key={i}
                  className="w-[3px] rounded-full bg-cyan-400 origin-bottom"
                  style={{
                    height: "100%",
                    transform: `scaleY(${h})`,
                    animationName: "bar-wave",
                    animationDuration: `${0.5 + i * 0.07}s`,
                    animationTimingFunction: "ease-in-out",
                    animationIterationCount: "infinite",
                    animationDelay: `${i * 0.08}s`,
                  }}
                />
              ))}
            </div>
          ) : (
            <>
              <span className="text-[9px] tracking-[0.35em] uppercase text-cyan-400/50 z-10">Talk to</span>
              <span className="font-display text-4xl italic text-white z-10 leading-none">Neo</span>
            </>
          )}
        </button>
      </div>

      {/* Last query */}
      {lastQuery && (
        <p className="z-10 text-[11px] text-zinc-600 mb-5 tracking-wide fade-up max-w-xs text-center">
          <span className="text-cyan-500/50">›</span> {lastQuery}
        </p>
      )}

      {/* ── Agent cards ──────────────────────────────── */}
      <div className="relative z-10 w-full max-w-md flex flex-col gap-[6px]">
        {agents.map((agent, i) => (
          <div
            key={agent.name}
            className="fade-up"
            style={{ animationDelay: `${i * 0.06}s`, opacity: 0 }}
          >
            <AgentCard name={agent.name} lastRun={agent.lastRun} status={agent.status} />
          </div>
        ))}
      </div>

      <VoicePlayer audioUrl={audioUrl} />
    </div>
  );
}
