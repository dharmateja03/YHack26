"use client";

interface AgentCardProps {
  name: string;
  lastRun: string | null;
  status: "idle" | "running" | "error";
}

const STATUS_COLOR: Record<AgentCardProps["status"], string> = {
  idle: "bg-green-400",
  running: "bg-yellow-400 animate-pulse",
  error: "bg-red-500",
};

export default function AgentCard({ name, lastRun, status }: AgentCardProps) {
  return (
    <div className="rounded-xl border border-zinc-700 bg-zinc-900 px-5 py-4 flex items-center gap-4">
      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${STATUS_COLOR[status]}`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-white truncate">{name}</p>
        <p className="text-xs text-zinc-400 mt-0.5">
          {lastRun ? `Last run: ${lastRun}` : "Never run"}
        </p>
      </div>
      <span className="text-xs text-zinc-500 capitalize">{status}</span>
    </div>
  );
}
