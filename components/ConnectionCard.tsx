"use client";

interface ConnectionCardProps {
  integration: string;
  connected: boolean;
  accountName?: string;
  onConnect: () => void;
  onDisconnect: () => void;
}

const ICONS: Record<string, string> = {
  github: "🐙",
  slack: "💬",
  jira: "📋",
  calendar: "📅",
};

export default function ConnectionCard({
  integration,
  connected,
  accountName,
  onConnect,
  onDisconnect,
}: ConnectionCardProps) {
  const label = integration.charAt(0).toUpperCase() + integration.slice(1);
  const icon = ICONS[integration] ?? "🔗";

  return (
    <div className="rounded-xl border border-zinc-700 bg-zinc-900 px-5 py-4 flex items-center gap-4">
      <span className="text-2xl">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-white">{label}</p>
        <p className="text-xs text-zinc-400 mt-0.5">
          {connected ? `Connected${accountName ? ` — ${accountName}` : ""}` : "Not connected"}
        </p>
      </div>
      {connected ? (
        <button
          onClick={onDisconnect}
          className="text-xs text-red-400 border border-red-800 rounded-lg px-3 py-1.5 hover:bg-red-900/30 transition-colors"
        >
          Disconnect
        </button>
      ) : (
        <button
          onClick={onConnect}
          className="text-xs text-white bg-zinc-700 rounded-lg px-3 py-1.5 hover:bg-zinc-600 transition-colors"
        >
          Connect
        </button>
      )}
    </div>
  );
}
