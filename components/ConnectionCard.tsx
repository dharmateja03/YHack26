"use client";

interface ConnectionCardProps {
  integration: string;
  connected: boolean;
  accountName?: string;
  onConnect: () => void;
  onDisconnect: () => void;
}

const INTEGRATIONS: Record<string, {
  label: string;
  description: string;
  accent: string;
  connectedBg: string;
  icon: React.ReactNode;
}> = {
  github: {
    label: "GitHub",
    description: "Pull requests · reviews · CI status",
    accent: "border-zinc-700/60 hover:border-zinc-600",
    connectedBg: "bg-zinc-800/30",
    icon: (
      <svg viewBox="0 0 24 24" className="w-5 h-5 fill-white" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 21.795 24 17.295 24 12c0-6.63-5.37-12-12-12z"/>
      </svg>
    ),
  },
  slack: {
    label: "Slack",
    description: "Messages · mentions · thread context",
    accent: "border-[#4a154b]/30 hover:border-[#4a154b]/60",
    connectedBg: "bg-[#4a154b]/10",
    icon: (
      <svg viewBox="0 0 24 24" className="w-5 h-5" xmlns="http://www.w3.org/2000/svg">
        <path fill="#E01E5A" d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z"/>
        <path fill="#36C5F0" d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z"/>
        <path fill="#2EB67D" d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.524 2.521 2.527 2.527 0 0 1-2.519-2.521V2.522A2.527 2.527 0 0 1 15.164 0a2.528 2.528 0 0 1 2.524 2.522v6.312z"/>
        <path fill="#ECB22E" d="M15.164 18.956a2.528 2.528 0 0 1 2.524 2.522A2.528 2.528 0 0 1 15.164 24a2.527 2.527 0 0 1-2.519-2.522v-2.522h2.519zM15.164 17.688a2.527 2.527 0 0 1-2.519-2.523 2.526 2.526 0 0 1 2.519-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.523 2.523h-6.313z"/>
      </svg>
    ),
  },
  jira: {
    label: "Jira",
    description: "Tickets · sprints · blockers",
    accent: "border-blue-900/30 hover:border-blue-700/50",
    connectedBg: "bg-blue-950/15",
    icon: (
      <svg viewBox="0 0 24 24" className="w-5 h-5" xmlns="http://www.w3.org/2000/svg">
        <path fill="#2684FF" d="M11.975 0C9.67 4.925 9.67 4.925 7.363 9.85c1.557 1.556 3.112 3.112 4.667 4.667l7.02-14.04c-2.357 0-4.717 0-7.075-.477z"/>
        <path fill="url(#jiraGrad1)" d="M7.363 9.85C5.056 14.775 5.056 14.775 2.75 19.7c2.357 0 4.717 0 7.075.477L14.642 9.85H7.363z"/>
        <path fill="#2684FF" d="M11.975 24c2.306-4.925 2.306-4.925 4.612-9.85-1.557-1.556-3.112-3.112-4.667-4.667L4.9 23.523C7.257 23.523 9.617 23.523 11.975 24z"/>
        <path fill="url(#jiraGrad2)" d="M16.587 14.15c2.307-4.925 2.307-4.925 4.613-9.85-2.357 0-4.717 0-7.075-.477L9.308 14.15h7.279z"/>
        <defs>
          <linearGradient id="jiraGrad1" x1="7.363" y1="9.85" x2="9.825" y2="15.169" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#0052CC"/>
            <stop offset="100%" stopColor="#2684FF"/>
          </linearGradient>
          <linearGradient id="jiraGrad2" x1="9.308" y1="14.15" x2="14.642" y2="9.85" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#0052CC"/>
            <stop offset="100%" stopColor="#2684FF"/>
          </linearGradient>
        </defs>
      </svg>
    ),
  },
  calendar: {
    label: "Nylas",
    description: "Gmail + Calendar sync · scheduling",
    accent: "border-green-900/30 hover:border-green-700/50",
    connectedBg: "bg-green-950/15",
    icon: (
      <svg viewBox="0 0 24 24" className="w-5 h-5" xmlns="http://www.w3.org/2000/svg">
        <path fill="#4285F4" d="M18 0H6L0 6v12l6 6h12l6-6V6l-6-6z"/>
        <path fill="#fff" d="M18 0H6L0 6h6l6-6z" opacity="0"/>
        <rect fill="#fff" x="3" y="3" width="18" height="18" rx="2"/>
        <path fill="#EA4335" d="M8 1v5h8V1H8z"/>
        <rect fill="#EA4335" x="7" y="0" width="2" height="4" rx="1"/>
        <rect fill="#EA4335" x="15" y="0" width="2" height="4" rx="1"/>
        <path fill="#4285F4" d="M3 8h18v1H3z"/>
        <text x="12" y="18" textAnchor="middle" fill="#4285F4" fontSize="7" fontWeight="bold">G</text>
      </svg>
    ),
  },
};

export default function ConnectionCard({
  integration,
  connected,
  accountName,
  onConnect,
  onDisconnect,
}: ConnectionCardProps) {
  const info = INTEGRATIONS[integration] ?? {
    label: integration.charAt(0).toUpperCase() + integration.slice(1),
    description: "Integration",
    accent: "border-zinc-700 hover:border-zinc-600",
    connectedBg: "bg-zinc-800/20",
    icon: <span className="text-zinc-400 text-lg">⬡</span>,
  };

  return (
    <div
      className={`group flex items-center gap-4 px-5 py-4 rounded-xl border transition-all duration-200
        ${connected
          ? `${info.connectedBg} ${info.accent}`
          : `bg-zinc-950 border-zinc-800/50 ${info.accent}`
        }`}
    >
      {/* Icon */}
      <div className="w-9 h-9 rounded-lg bg-zinc-800/60 flex items-center justify-center shrink-0">
        {info.icon}
      </div>

      {/* Text */}
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium text-zinc-100 tracking-tight">{info.label}</p>
        <p className="text-[10px] text-zinc-600 mt-0.5 tracking-wide">
          {connected
            ? <span className="text-emerald-400/80">{accountName ? `Connected — ${accountName}` : "Connected ✓"}</span>
            : info.description
          }
        </p>
      </div>

      {/* Action button */}
      {connected ? (
        <button
          onClick={onDisconnect}
          className="text-[10px] tracking-widest uppercase text-red-500/70 border border-red-900/40 rounded-lg px-3 py-1.5 hover:bg-red-950/30 hover:text-red-400 hover:border-red-800/60 transition-all duration-150"
        >
          Disconnect
        </button>
      ) : (
        <button
          onClick={onConnect}
          className="text-[10px] tracking-widest uppercase text-cyan-400 border border-cyan-500/20 rounded-lg px-3 py-1.5 hover:bg-cyan-950/30 hover:border-cyan-400/40 transition-all duration-150"
        >
          Connect
        </button>
      )}
    </div>
  );
}
