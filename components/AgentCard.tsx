"use client";

const AGENT_GLYPHS: Record<string, string> = {
  "Neo Brief":  "◎",
  "Neo PR":     "⌥",
  "Neo Sched":  "◈",
  "Neo Root":   "⊕",
  "Neo Sprint": "◉",
};

const AGENT_DESC: Record<string, string> = {
  "Neo Brief":  "morning · evening",
  "Neo PR":     "blockers · review",
  "Neo Sched":  "calendar · book",
  "Neo Root":   "trace · diagnose",
  "Neo Sprint": "forecast · notes",
};

const STATUS: Record<string, { dot: string; label: string; color: string }> = {
  idle:    { dot: "bg-emerald-400",            label: "idle",    color: "text-emerald-400/70" },
  running: { dot: "bg-cyan-400 animate-pulse", label: "running", color: "text-cyan-400"       },
  error:   { dot: "bg-red-500",                label: "error",   color: "text-red-400"        },
};

interface AgentCardProps {
  name: string;
  lastRun: string | null;
  status: "idle" | "running" | "error";
}

export default function AgentCard({ name, lastRun, status }: AgentCardProps) {
  const s    = STATUS[status];
  const glyph = AGENT_GLYPHS[name] ?? "◦";
  const desc  = AGENT_DESC[name] ?? "";

  return (
    <div
      className={`group relative flex items-center gap-4 px-4 py-3 rounded-lg border transition-all duration-200
        ${status === "running"
          ? "bg-cyan-950/15 border-cyan-500/25"
          : "bg-zinc-950 border-zinc-800/50 hover:bg-zinc-900/60 hover:border-zinc-700/70"
        }`}
    >
      {/* Left accent bar */}
      <div
        className={`absolute left-0 top-[18%] bottom-[18%] w-[2px] rounded-full transition-all duration-300
          ${status === "running" ? "bg-cyan-400" : "bg-zinc-700 group-hover:bg-zinc-500"}`}
      />

      {/* Glyph */}
      <span
        className={`text-base w-5 text-center select-none transition-colors duration-200
          ${status === "running" ? "text-cyan-400" : "text-zinc-600 group-hover:text-zinc-400"}`}
      >
        {glyph}
      </span>

      {/* Name + description */}
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium text-zinc-200 tracking-tight leading-none">{name}</p>
        <p className="text-[10px] text-zinc-600 mt-1 tracking-wider">{desc}</p>
      </div>

      {/* Last run */}
      <span className="text-[10px] text-zinc-600 tabular-nums">
        {lastRun ?? "—"}
      </span>

      {/* Status */}
      <div className="flex items-center gap-[6px]">
        <div className={`w-[6px] h-[6px] rounded-full flex-shrink-0 ${s.dot}`} />
        <span className={`text-[10px] tracking-[0.15em] uppercase ${s.color}`}>{s.label}</span>
      </div>
    </div>
  );
}
