"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

// ── Types ──────────────────────────────────────────────────────────────────────

interface PrRiskItem {
  prId: string;
  title: string;
  author: string;
  approvals: number;
  requiredApprovals: number;
  updatedAt?: string;
  riskScore: number;
}

interface SprintRisk {
  onTrack: boolean;
  blockedCount: number;
  velocity: number;
}

interface MeetingLoad {
  userId: string;
  name: string;
  meetingsThisWeek: number;
}

interface Blocker {
  ticketId: string;
  title: string;
  priority: number;
  status: string;
  assignee?: string;
  blockedBy: string[];
}

interface DashboardData {
  prRisk:      { count: number; stale: PrRiskItem[] };
  sprintRisk:  SprintRisk;
  meetingLoad: MeetingLoad[];
  blockers:    Blocker[];
}

type RiskLevel = "critical" | "high" | "medium" | "good";

// ── Helpers ────────────────────────────────────────────────────────────────────

function timeAgo(iso?: string): string {
  if (!iso) return "—";
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3600000);
  if (h < 1) return "just now";
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function riskColor(level: RiskLevel) {
  return {
    critical: { dot: "bg-red-500",     text: "text-red-400",     badge: "bg-red-950/30 text-red-400 border-red-500/20",     bar: "bg-red-500" },
    high:     { dot: "bg-amber-500",   text: "text-amber-400",   badge: "bg-amber-950/30 text-amber-400 border-amber-500/20", bar: "bg-amber-500" },
    medium:   { dot: "bg-yellow-500",  text: "text-yellow-400",  badge: "bg-yellow-950/30 text-yellow-400 border-yellow-500/20", bar: "bg-yellow-500" },
    good:     { dot: "bg-emerald-500", text: "text-emerald-400", badge: "bg-emerald-950/20 text-emerald-400 border-emerald-500/20", bar: "bg-emerald-500" },
  }[level];
}

function prRiskLevel(count: number): RiskLevel {
  if (count >= 5) return "critical";
  if (count >= 3) return "high";
  if (count >= 1) return "medium";
  return "good";
}

function sprintRiskLevel(s: SprintRisk): RiskLevel {
  if (!s.onTrack && s.blockedCount >= 3) return "critical";
  if (!s.onTrack) return "high";
  if (s.blockedCount > 0) return "medium";
  return "good";
}

function meetingRiskLevel(load: MeetingLoad[]): RiskLevel {
  if (!load.length) return "good";
  const max = Math.max(...load.map(m => m.meetingsThisWeek));
  if (max >= 10) return "critical";
  if (max >= 7)  return "high";
  if (max >= 5)  return "medium";
  return "good";
}

function blockerRiskLevel(blockers: Blocker[]): RiskLevel {
  const p0 = blockers.filter(b => b.priority <= 1).length;
  if (p0 >= 2 || blockers.length >= 5) return "critical";
  if (p0 >= 1 || blockers.length >= 3) return "high";
  if (blockers.length >= 1) return "medium";
  return "good";
}

function getRiskLabel(level: RiskLevel) {
  return { critical: "Critical", high: "At Risk", medium: "Monitor", good: "Healthy" }[level];
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function Pulse({ level }: { level: RiskLevel }) {
  const c = riskColor(level);
  return (
    <span className="relative flex h-2 w-2">
      <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-50 ${c.dot}`} />
      <span className={`relative inline-flex rounded-full h-2 w-2 ${c.dot}`} />
    </span>
  );
}

function RiskChip({ level }: { level: RiskLevel }) {
  const c = riskColor(level);
  return (
    <span className={`inline-flex items-center gap-1.5 text-[9px] tracking-[0.2em] uppercase px-2.5 py-1 rounded-full border ${c.badge}`}>
      <Pulse level={level} />
      {getRiskLabel(level)}
    </span>
  );
}

function Skeleton() {
  return (
    <div className="bg-zinc-900/60 border border-zinc-800/60 rounded-2xl p-5 space-y-3 animate-pulse">
      <div className="flex justify-between items-start">
        <div className="h-2.5 w-20 bg-zinc-800 rounded-full" />
        <div className="h-5 w-16 bg-zinc-800/60 rounded-full" />
      </div>
      <div className="h-10 w-14 bg-zinc-800 rounded-lg" />
      <div className="space-y-2">
        <div className="h-2 w-full bg-zinc-800 rounded" />
        <div className="h-2 w-4/5 bg-zinc-800 rounded" />
        <div className="h-2 w-3/5 bg-zinc-800 rounded" />
      </div>
    </div>
  );
}

function MetricCard({
  icon, label, value, unit, level, children,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  unit?: string;
  level: RiskLevel;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const c = riskColor(level);

  return (
    <div className={`relative bg-zinc-900/50 border rounded-2xl overflow-hidden transition-all duration-200 ${open ? "border-zinc-700" : "border-zinc-800/60 hover:border-zinc-700/60"}`}>
      {/* Subtle top gradient line based on risk */}
      <div className={`absolute inset-x-0 top-0 h-[1px] ${c.bar} opacity-60`} />

      <div className="p-5 space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className={`w-8 h-8 rounded-xl flex items-center justify-center bg-zinc-800/80 ${c.text}`}>
              {icon}
            </div>
            <span className="text-[10px] tracking-[0.2em] uppercase text-zinc-500">{label}</span>
          </div>
          <RiskChip level={level} />
        </div>

        {/* Value */}
        <div className="flex items-end gap-1.5">
          <span className="text-4xl font-bold text-white tabular-nums leading-none">{value}</span>
          {unit && <span className="text-[11px] text-zinc-600 mb-1">{unit}</span>}
        </div>

        {/* Expand toggle */}
        {children && (
          <button
            onClick={() => setOpen(v => !v)}
            className={`w-full flex items-center justify-between text-[10px] tracking-widest uppercase transition-colors py-1 ${open ? "text-zinc-400" : "text-zinc-700 hover:text-zinc-500"}`}
          >
            <span>Details</span>
            <svg viewBox="0 0 24 24" className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>
        )}
      </div>

      {/* Collapsible detail panel */}
      {children && open && (
        <div className="border-t border-zinc-800/60 px-5 pb-5 pt-4 bg-zinc-950/40">
          {children}
        </div>
      )}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [data, setData]       = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [activeTab, setActiveTab] = useState<"overview" | "prs" | "blockers">("overview");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/dashboard");
      if (!res.ok) throw new Error(`${res.status}`);
      setData(await res.json());
      setLastRefresh(new Date());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const prLevel      = data ? prRiskLevel(data.prRisk.count)            : "good";
  const sprintLevel  = data ? sprintRiskLevel(data.sprintRisk)          : "good";
  const meetingLevel = data ? meetingRiskLevel(data.meetingLoad)        : "good";
  const blockLevel   = data ? blockerRiskLevel(data.blockers)           : "good";

  const topMeeting   = data?.meetingLoad[0]?.meetingsThisWeek ?? 0;

  return (
    <div className="min-h-screen bg-black text-zinc-100">

      {/* Top nav bar */}
      <div className="sticky top-0 z-30 border-b border-zinc-800/50 bg-black/80 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="flex items-center gap-2 text-zinc-600 hover:text-zinc-400 transition-colors">
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="15 18 9 12 15 6"/>
              </svg>
              <span className="text-[11px]">Neo</span>
            </Link>
            <span className="text-zinc-800">|</span>
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
              <span className="text-[11px] tracking-[0.25em] uppercase text-zinc-400">Org Health</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {lastRefresh && (
              <span className="text-[10px] text-zinc-700">
                Updated {lastRefresh.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
            <button
              onClick={load}
              disabled={loading}
              className="flex items-center gap-1.5 text-[10px] tracking-widest uppercase text-zinc-600 hover:text-cyan-400 transition-colors disabled:opacity-50"
            >
              <svg viewBox="0 0 24 24" className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="23 4 23 10 17 10"/>
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
              </svg>
              Refresh
            </button>
          </div>
        </div>
      </div>

      {/* Subtle grid background */}
      <div className="pointer-events-none fixed inset-0 opacity-[0.018]"
        style={{ backgroundImage: "linear-gradient(rgba(6,182,212,1) 1px, transparent 1px), linear-gradient(90deg, rgba(6,182,212,1) 1px, transparent 1px)", backgroundSize: "48px 48px" }} />

      <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">

        {/* Page heading */}
        <div className="flex items-end justify-between">
          <div>
            <p className="text-[9px] tracking-[0.4em] uppercase text-cyan-400/50 mb-1">Neosis</p>
            <h1 className="text-3xl font-bold text-white leading-none">Org Health</h1>
            <p className="text-[12px] text-zinc-600 mt-2">Live snapshot of your team's performance and risks.</p>
          </div>
          <Link
            href="/"
            className="hidden sm:flex items-center gap-2 px-4 py-2 bg-cyan-500/10 border border-cyan-500/15 rounded-xl text-[11px] text-cyan-400 tracking-wider uppercase hover:bg-cyan-500/20 transition-all"
          >
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
            Ask Neo
          </Link>
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-3 bg-red-950/20 border border-red-500/20 rounded-xl px-4 py-3">
            <svg viewBox="0 0 24 24" className="w-4 h-4 text-red-400 shrink-0" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <span className="text-[12px] text-red-400">Failed to load: {error}</span>
            <button onClick={load} className="ml-auto text-[11px] text-red-400/70 hover:text-red-300 underline">retry</button>
          </div>
        )}

        {/* Metric cards grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {loading ? (
            <><Skeleton/><Skeleton/><Skeleton/><Skeleton/></>
          ) : data ? (
            <>
              {/* PR Risk */}
              <MetricCard
                icon={<svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/></svg>}
                label="PR Risk"
                value={data.prRisk.count}
                unit="stale PRs"
                level={prLevel}
              >
                <div className="space-y-2.5">
                  {data.prRisk.stale.slice(0,4).map(pr => (
                    <div key={pr.prId} className="flex items-start gap-2">
                      <div className={`w-1 h-1 rounded-full mt-1.5 shrink-0 ${pr.approvals === 0 ? "bg-red-500" : "bg-amber-500"}`} />
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] text-zinc-300 truncate leading-snug">{pr.title}</p>
                        <p className="text-[9px] text-zinc-600 mt-0.5">{pr.approvals}/{pr.requiredApprovals} approvals · {timeAgo(pr.updatedAt)}</p>
                      </div>
                      <span className="text-[9px] text-zinc-700 shrink-0">#{pr.riskScore}</span>
                    </div>
                  ))}
                  {data.prRisk.stale.length === 0 && <p className="text-[11px] text-zinc-600">No stale PRs — clean queue.</p>}
                </div>
              </MetricCard>

              {/* Sprint Risk */}
              <MetricCard
                icon={<svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>}
                label="Sprint Risk"
                value={data.sprintRisk.blockedCount}
                unit="blocked"
                level={sprintLevel}
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-zinc-600">Status</span>
                    <span className={data.sprintRisk.onTrack ? "text-emerald-400" : "text-amber-400"}>
                      {data.sprintRisk.onTrack ? "On track" : "Behind"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-zinc-600">Velocity</span>
                    <span className="text-zinc-300">{data.sprintRisk.velocity} pts</span>
                  </div>
                  {/* Progress bar */}
                  <div>
                    <div className="flex justify-between text-[9px] text-zinc-700 mb-1">
                      <span>Sprint progress</span>
                      <span>{data.sprintRisk.onTrack ? "50%+" : "<50%"}</span>
                    </div>
                    <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-700 ${data.sprintRisk.onTrack ? "bg-emerald-500" : "bg-amber-500"}`}
                        style={{ width: data.sprintRisk.onTrack ? "60%" : "35%" }}
                      />
                    </div>
                  </div>
                </div>
              </MetricCard>

              {/* Meeting Load */}
              <MetricCard
                icon={<svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>}
                label="Meeting Load"
                value={topMeeting}
                unit="max / wk"
                level={meetingLevel}
              >
                <div className="space-y-2">
                  {data.meetingLoad.slice(0, 4).map(m => (
                    <div key={m.userId} className="space-y-0.5">
                      <div className="flex justify-between text-[10px]">
                        <span className="text-zinc-400 truncate">{m.name}</span>
                        <span className="text-zinc-600 shrink-0 ml-2">{m.meetingsThisWeek}</span>
                      </div>
                      <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${m.meetingsThisWeek >= 8 ? "bg-red-500" : m.meetingsThisWeek >= 5 ? "bg-amber-500" : "bg-cyan-500"}`}
                          style={{ width: `${Math.min(100, (m.meetingsThisWeek / 12) * 100)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                  {!data.meetingLoad.length && <p className="text-[11px] text-zinc-600">No calendar data this week.</p>}
                </div>
              </MetricCard>

              {/* Blockers */}
              <MetricCard
                icon={<svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>}
                label="Blockers"
                value={data.blockers.length}
                unit="tickets blocked"
                level={blockLevel}
              >
                <div className="space-y-2.5">
                  {data.blockers.slice(0,4).map(b => (
                    <div key={b.ticketId} className="flex items-start gap-2">
                      <span className={`text-[9px] font-bold shrink-0 mt-0.5 ${b.priority <= 1 ? "text-red-400" : b.priority <= 2 ? "text-amber-400" : "text-zinc-500"}`}>
                        P{b.priority}
                      </span>
                      <div className="min-w-0">
                        <p className="text-[11px] text-zinc-300 truncate leading-snug">{b.title}</p>
                        <p className="text-[9px] text-red-400/60 mt-0.5 truncate">
                          ← {b.blockedBy.slice(0,2).join(", ")}{b.blockedBy.length > 2 ? ` +${b.blockedBy.length - 2}` : ""}
                        </p>
                      </div>
                    </div>
                  ))}
                  {!data.blockers.length && <p className="text-[11px] text-zinc-600">No blockers — team is unblocked.</p>}
                </div>
              </MetricCard>
            </>
          ) : null}
        </div>

        {/* Tab bar */}
        {data && !loading && (
          <div className="flex items-center gap-1 border-b border-zinc-800/50">
            {(["overview", "prs", "blockers"] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2.5 text-[11px] tracking-widest uppercase transition-all border-b-[1.5px] -mb-px ${
                  activeTab === tab
                    ? "text-cyan-400 border-cyan-400"
                    : "text-zinc-600 border-transparent hover:text-zinc-400 hover:border-zinc-700"
                }`}
              >
                {tab === "overview" ? "Overview" : tab === "prs" ? `PRs (${data.prRisk.stale.length})` : `Blockers (${data.blockers.length})`}
              </button>
            ))}
          </div>
        )}

        {/* Tab: Overview */}
        {data && !loading && activeTab === "overview" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

            {/* Sprint health */}
            <div className="bg-zinc-900/40 border border-zinc-800/60 rounded-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-zinc-800/40 flex items-center gap-3">
                <span className="text-[10px] tracking-[0.25em] uppercase text-zinc-500">Sprint Health</span>
                <RiskChip level={sprintLevel} />
              </div>
              <div className="p-5 space-y-4">
                <div className="grid grid-cols-3 gap-4">
                  {[
                    { label: "Velocity",  value: `${data.sprintRisk.velocity} pts` },
                    { label: "Blocked",   value: `${data.sprintRisk.blockedCount}` },
                    { label: "Status",    value: data.sprintRisk.onTrack ? "On track" : "At risk" },
                  ].map(({ label, value }) => (
                    <div key={label} className="text-center p-3 bg-zinc-950/60 rounded-xl border border-zinc-800/40">
                      <p className="text-[9px] tracking-widest uppercase text-zinc-600 mb-1">{label}</p>
                      <p className="text-[15px] font-semibold text-zinc-200">{value}</p>
                    </div>
                  ))}
                </div>
                {/* Simulated progress */}
                <div>
                  <div className="flex justify-between text-[10px] text-zinc-600 mb-2">
                    <span>Sprint completion</span>
                    <span>{data.sprintRisk.onTrack ? "~60%" : "~35%"}</span>
                  </div>
                  <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${data.sprintRisk.onTrack ? "bg-emerald-500" : "bg-amber-500"}`}
                      style={{ width: data.sprintRisk.onTrack ? "60%" : "35%", transition: "width 1s ease" }}
                    />
                  </div>
                  {data.sprintRisk.blockedCount > 0 && (
                    <p className="text-[10px] text-amber-400/70 mt-2">
                      {data.sprintRisk.blockedCount} blocked {data.sprintRisk.blockedCount === 1 ? "story" : "stories"} — resolve to improve velocity
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Meeting distribution */}
            <div className="bg-zinc-900/40 border border-zinc-800/60 rounded-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-zinc-800/40 flex items-center gap-3">
                <span className="text-[10px] tracking-[0.25em] uppercase text-zinc-500">Meeting Load This Week</span>
                <RiskChip level={meetingLevel} />
              </div>
              <div className="p-5 space-y-3">
                {data.meetingLoad.length === 0 ? (
                  <p className="text-[12px] text-zinc-600 py-4 text-center">No calendar data available.</p>
                ) : data.meetingLoad.slice(0, 6).map((m, i) => {
                  const pct = Math.min(100, (m.meetingsThisWeek / Math.max(topMeeting, 1)) * 100);
                  const col = m.meetingsThisWeek >= 8 ? "bg-red-500" : m.meetingsThisWeek >= 5 ? "bg-amber-500" : "bg-cyan-500";
                  return (
                    <div key={m.userId} className="flex items-center gap-3">
                      <div className="w-24 shrink-0">
                        <p className="text-[12px] text-zinc-300 truncate">{m.name}</p>
                      </div>
                      <div className="flex-1 h-5 bg-zinc-800/60 rounded-lg overflow-hidden relative">
                        <div
                          className={`h-full ${col} rounded-lg transition-all`}
                          style={{ width: `${pct}%`, transitionDuration: `${600 + i * 100}ms` }}
                        />
                        <span className="absolute inset-y-0 right-2 flex items-center text-[9px] text-zinc-500">{m.meetingsThisWeek}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Tab: PRs */}
        {data && !loading && activeTab === "prs" && (
          <div className="bg-zinc-900/40 border border-zinc-800/60 rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-zinc-800/40 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-[10px] tracking-[0.25em] uppercase text-zinc-500">Stale Pull Requests</span>
                <RiskChip level={prLevel} />
              </div>
              <span className="text-[10px] text-zinc-700">{data.prRisk.stale.length} need attention</span>
            </div>
            {data.prRisk.stale.length === 0 ? (
              <div className="px-5 py-12 text-center">
                <div className="w-10 h-10 rounded-full bg-emerald-950/30 border border-emerald-500/20 flex items-center justify-center mx-auto mb-3">
                  <span className="text-emerald-400 text-base">✓</span>
                </div>
                <p className="text-[13px] text-zinc-400">All PRs are reviewed and current.</p>
              </div>
            ) : (
              <div className="divide-y divide-zinc-800/40">
                {data.prRisk.stale.map(pr => (
                  <div key={pr.prId} className="px-5 py-4 flex items-center gap-4 hover:bg-zinc-800/20 transition-colors group">
                    <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${pr.approvals === 0 ? "bg-red-500" : "bg-amber-500"}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] text-zinc-200 truncate font-medium">{pr.title}</p>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-[10px] text-zinc-600">{pr.prId}</span>
                        <span className="text-[10px] text-zinc-600">by {pr.author}</span>
                        <span className="text-[10px] text-zinc-600">updated {timeAgo(pr.updatedAt)}</span>
                      </div>
                    </div>
                    <div className="shrink-0 flex items-center gap-2.5">
                      <div className="text-center">
                        <p className="text-[10px] text-zinc-600 leading-none mb-0.5">Reviews</p>
                        <p className="text-[13px] font-semibold text-zinc-300">{pr.approvals}<span className="text-zinc-700">/{pr.requiredApprovals}</span></p>
                      </div>
                      <span className={`text-[9px] px-2.5 py-1 rounded-full border ${pr.approvals === 0 ? "text-red-400 border-red-500/20 bg-red-950/20" : "text-amber-400 border-amber-500/20 bg-amber-950/20"}`}>
                        {pr.approvals === 0 ? "No reviews" : `${pr.requiredApprovals - pr.approvals} needed`}
                      </span>
                      <span className="text-[9px] text-zinc-800 px-2 py-0.5 bg-zinc-900 rounded-full border border-zinc-800 shrink-0">
                        risk {pr.riskScore}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tab: Blockers */}
        {data && !loading && activeTab === "blockers" && (
          <div className="bg-zinc-900/40 border border-zinc-800/60 rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-zinc-800/40 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-[10px] tracking-[0.25em] uppercase text-zinc-500">Blocked Tickets</span>
                <RiskChip level={blockLevel} />
              </div>
              <span className="text-[10px] text-zinc-700">{data.blockers.length} blocked</span>
            </div>
            {data.blockers.length === 0 ? (
              <div className="px-5 py-12 text-center">
                <div className="w-10 h-10 rounded-full bg-emerald-950/30 border border-emerald-500/20 flex items-center justify-center mx-auto mb-3">
                  <span className="text-emerald-400 text-base">✓</span>
                </div>
                <p className="text-[13px] text-zinc-400">No blocked tickets — team is moving.</p>
              </div>
            ) : (
              <div className="divide-y divide-zinc-800/40">
                {data.blockers.map(b => (
                  <div key={b.ticketId} className="px-5 py-4 flex items-start gap-4 hover:bg-zinc-800/20 transition-colors">
                    <span className={`text-[11px] font-bold shrink-0 mt-0.5 w-6 ${b.priority <= 1 ? "text-red-400" : b.priority <= 2 ? "text-amber-400" : "text-zinc-500"}`}>
                      P{b.priority}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] text-zinc-200 font-medium">{b.title}</p>
                      <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                        <span className="text-[10px] text-zinc-600">{b.ticketId}</span>
                        {b.assignee && <span className="text-[10px] text-zinc-600">→ {b.assignee}</span>}
                        <span className={`text-[9px] px-2 py-0.5 rounded-full border ${
                          b.status === "in_progress" ? "text-cyan-400 border-cyan-500/20 bg-cyan-950/20" :
                          b.status === "review" ? "text-purple-400 border-purple-500/20 bg-purple-950/20" :
                          "text-zinc-500 border-zinc-700"
                        }`}>{b.status}</span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                        <span className="text-[9px] text-zinc-700">blocked by:</span>
                        {b.blockedBy.slice(0, 3).map(dep => (
                          <span key={dep} className="text-[9px] px-2 py-0.5 bg-zinc-900 border border-zinc-800 rounded-full text-red-400/70">{dep}</span>
                        ))}
                        {b.blockedBy.length > 3 && (
                          <span className="text-[9px] text-zinc-700">+{b.blockedBy.length - 3}</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Footer CTA */}
        <div className="flex items-center gap-4 pt-2 pb-8">
          <Link href="/" className="flex items-center gap-2 px-4 py-2.5 bg-zinc-900/60 border border-zinc-800 rounded-xl text-[11px] text-zinc-400 tracking-wider uppercase hover:bg-zinc-800 hover:text-zinc-200 hover:border-zinc-700 transition-all">
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
            Talk to Neo
          </Link>
          <p className="text-[11px] text-zinc-700">
            Ask Neo to prioritize blockers, schedule PR reviews, or generate a brief.
          </p>
        </div>
      </div>
    </div>
  );
}
