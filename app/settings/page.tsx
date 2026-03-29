"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import ConnectionCard from "@/components/ConnectionCard";
import { useUser } from "@auth0/nextjs-auth0/client";

interface ConnectedState {
  github: boolean;
  slack: boolean;
  jira: boolean;
  calendar: boolean;
}

type IntegrationKey = keyof ConnectedState;

interface OrgMember {
  orgId: string;
  userId: string;
  name?: string;
  email?: string;
  workEmail?: string;
  role: "manager" | "member";
  joinedAt: string;
}

interface OrgInvite {
  token: string;
  expiresAt: string;
  uses: number;
  maxUses: number;
}

interface OrgDoc {
  orgId: string;
  name: string;
  slug: string;
}

interface OrgContext {
  org: OrgDoc | null;
  me: OrgMember | null;
  members: OrgMember[];
  invites: OrgInvite[];
}

const INTEGRATIONS: IntegrationKey[] = ["github", "slack", "jira", "calendar"];

const KEY_LABELS: Record<IntegrationKey, string> = {
  github: "GitHub Personal Access Token",
  slack: "Slack Bot/User Token",
  jira: "Jira API Token",
  calendar: "Nylas API Key",
};

const KEY_PLACEHOLDERS: Record<IntegrationKey, string> = {
  github: "ghp_****",
  slack: "xoxb-**** / xoxp-**** / xapp-****",
  jira: "jira_****",
  calendar: "nyk_****",
};

const ONBOARDING_STEPS = ["Profile", "Org", "Integrations", "Done"] as const;
type OnboardingStep = 0 | 1 | 2 | 3;

export default function SettingsPage() {
  const { user, isLoading } = useUser();
  const searchParams = useSearchParams();
  const router = useRouter();
  const isOnboarding = searchParams.get("onboarding") === "1";
  const [onboardingStep, setOnboardingStep] = useState<OnboardingStep>(0);

  const [connected, setConnected] = useState<ConnectedState>({
    github: false,
    slack: false,
    jira: false,
    calendar: false,
  });
  const [accountNames, setAccountNames] = useState<Partial<Record<IntegrationKey, string>>>({});

  const [org, setOrg] = useState<OrgContext>({ org: null, me: null, members: [], invites: [] });
  const [orgName, setOrgName] = useState("");
  const [workEmail, setWorkEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  const [editorIntegration, setEditorIntegration] = useState<IntegrationKey | null>(null);
  const [editorToken, setEditorToken] = useState("");
  const [jiraDomain, setJiraDomain] = useState("");
  const [jiraEmail, setJiraEmail] = useState("");
  const loadVersionRef = useRef(0);

  const isManager = org.me?.role === "manager";

  const integrationHelp = useMemo(() => {
    if (!editorIntegration) return "";
    if (editorIntegration === "calendar") {
      return "Paste your Nylas API key (starts with nyk_). We verify before saving.";
    }
    if (editorIntegration === "github") {
      return "Paste your GitHub token (starts with ghp_/gho_/ghu_/ghs_). We verify before saving.";
    }
    if (editorIntegration === "slack") {
      return "Paste your Slack token (starts with xoxb-/xoxp-/xapp-). We verify before saving.";
    }
    return `Paste your ${KEY_LABELS[editorIntegration]}.`;
  }, [editorIntegration]);

  const refreshOrgContext = async () => {
    const res = await fetch("/api/orgs/me", { cache: "no-store" }).catch(() => null);
    if (res?.ok) {
      const data = (await res.json().catch(() => null)) as OrgContext | null;
      if (data) setOrg(data);
    }
  };

  useEffect(() => {
    if (isLoading) return;

    const version = ++loadVersionRef.current;
    let cancelled = false;
    const load = async () => {
      const [userRes, orgRes, keysRes] = await Promise.all([
        fetch("/api/users/me?lite=1", { cache: "no-store" }).catch(() => null),
        fetch("/api/orgs/me", { cache: "no-store" }).catch(() => null),
        fetch("/api/users/keys", { cache: "no-store" }).catch(() => null),
      ]);

      if (cancelled || version !== loadVersionRef.current) return;

      if (userRes?.ok) {
        const data = await userRes.json().catch(() => null);
        if (data?.connected) {
          setConnected({
            github: Boolean(data.connected.github),
            slack: Boolean(data.connected.slack),
            jira: Boolean(data.connected.jira),
            calendar: Boolean(data.connected.calendar),
          });
        }
        if (!displayName && data?.name) setDisplayName(data.name);
        if (!workEmail && data?.email) setWorkEmail(data.email);
      }

      if (orgRes?.ok) {
        const data = (await orgRes.json().catch(() => null)) as OrgContext | null;
        if (data) {
          setOrg(data);
          setWorkEmail(data.me?.workEmail ?? data.me?.email ?? "");
          setDisplayName(data.me?.name ?? user?.name ?? "");
        }
      }

      if (keysRes?.ok) {
        const keys = await keysRes.json().catch(() => null);
        if (keys?.configured) {
          setConnected({
            github: Boolean(keys.configured.github),
            slack: Boolean(keys.configured.slack),
            jira: Boolean(keys.configured.jira),
            calendar: Boolean(keys.configured.calendar),
          });
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [isLoading, user?.sub]);

  const toInviteUrl = (token: string) => {
    if (typeof window === "undefined") return `/join/${token}`;
    return `${window.location.origin}/join/${token}`;
  };

  const createOrg = async () => {
    if (!orgName.trim()) return;
    loadVersionRef.current += 1;
    setBusy(true);
    setMessage(null);

    const res = await fetch("/api/orgs/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgName }),
    });

    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setMessage(data?.error ?? "Failed to create org.");
      setBusy(false);
      return;
    }

    setOrg({
      org: data.org,
      me: data.me,
      members: data.members ?? [],
      invites: data.invites ?? [],
    });

    if (data.firstInviteToken) {
      setInviteLink(toInviteUrl(data.firstInviteToken));
    }

    setMessage("Organization created.");
    setBusy(false);
  };

  const generateInvite = async () => {
    loadVersionRef.current += 1;
    setBusy(true);
    setMessage(null);

    const res = await fetch("/api/orgs/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ daysValid: 7, maxUses: 100 }),
    });

    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setMessage(data?.error ?? "Failed to create invite.");
      setBusy(false);
      return;
    }

    const token = data?.invite?.token;
    if (token) {
      const link = toInviteUrl(token);
      setInviteLink(link);
      if (data?.invite && org.org) {
        setOrg((prev) => ({
          ...prev,
          invites: [data.invite as OrgInvite, ...prev.invites.filter((i) => i.token !== token)],
        }));
      }
      try {
        await navigator.clipboard.writeText(link);
      } catch {
        // no-op
      }
    }

    if (data?.bootstrappedOrg || !org.org) {
      await refreshOrgContext();
    }

    setMessage("Invite link generated.");
    setBusy(false);
  };

  const saveProfile = async () => {
    loadVersionRef.current += 1;
    setBusy(true);
    setMessage(null);

    const res = await fetch("/api/orgs/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: displayName, workEmail }),
    });

    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setMessage(data?.error ?? "Failed to save profile.");
      setBusy(false);
      return;
    }

    if (data?.member) {
      setOrg((prev) => {
        if (!prev.org) return prev;
        const members = prev.members.some((m) => m.userId === data.member.userId)
          ? prev.members.map((m) => (m.userId === data.member.userId ? data.member : m))
          : [data.member, ...prev.members];
        return { ...prev, me: data.member, members };
      });
    }

    if (data?.bootstrappedOrg || !org.org) {
      await refreshOrgContext();
    }

    setMessage("Profile saved.");
    setBusy(false);
  };

  const handleConnect = (integration: IntegrationKey) => {
    setEditorIntegration(integration);
    setEditorToken("");
    setMessage(null);
  };

  const saveIntegrationToken = async () => {
    if (!editorIntegration || !editorToken.trim()) return;
    setBusy(true);
    setMessage(null);

    const res = await fetch("/api/users/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        integration: editorIntegration,
        token: editorToken.trim(),
        ...(editorIntegration === "jira" && jiraDomain ? { jiraDomain, jiraEmail } : {}),
      }),
    });

    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setMessage(data?.error ?? `Failed to save ${editorIntegration} key.`);
      setBusy(false);
      return;
    }

    setConnected((prev) => ({ ...prev, [editorIntegration]: true }));
    if (data?.accountName) {
      setAccountNames((prev) => ({ ...prev, [editorIntegration]: data.accountName }));
    }
    setEditorToken("");
    setEditorIntegration(null);
    setJiraDomain("");
    setJiraEmail("");
    setMessage(`${editorIntegration === "calendar" ? "Nylas" : editorIntegration} key verified and saved.`);
    setBusy(false);
  };

  const handleDisconnect = async (integration: IntegrationKey) => {
    setBusy(true);
    setMessage(null);

    const res = await fetch("/api/users/keys", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ integration }),
    });

    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setMessage(data?.error ?? `Failed to disconnect ${integration}.`);
      setBusy(false);
      return;
    }

    setConnected((prev) => ({ ...prev, [integration]: false }));
    setMessage(`${integration === "calendar" ? "Nylas" : integration} disconnected.`);
    setBusy(false);
  };

  return (
    <div className="relative min-h-[calc(100vh-65px)] px-6 py-14 overflow-hidden">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.025]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(6,182,212,1) 1px, transparent 1px), linear-gradient(90deg, rgba(6,182,212,1) 1px, transparent 1px)",
          backgroundSize: "60px 60px",
        }}
      />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_0%,transparent_40%,black_100%)]" />

      <div className="relative z-10 max-w-3xl mx-auto">

        {/* Onboarding wizard header */}
        {isOnboarding && (
          <div className="mb-8">
            <p className="text-[10px] tracking-[0.3em] uppercase text-cyan-400/60 mb-4">Getting Started</p>
            <div className="flex items-center gap-0">
              {ONBOARDING_STEPS.map((step, i) => (
                <div key={step} className="flex items-center">
                  <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] tracking-wider uppercase transition-all ${i === onboardingStep ? "bg-cyan-500/15 text-cyan-400 border border-cyan-500/30" : i < onboardingStep ? "text-emerald-400/70" : "text-zinc-700"}`}>
                    {i < onboardingStep && <span>✓</span>}
                    {step}
                  </div>
                  {i < ONBOARDING_STEPS.length - 1 && (
                    <div className={`w-6 h-px mx-1 ${i < onboardingStep ? "bg-emerald-500/40" : "bg-zinc-800"}`} />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mb-10">
          <p className="text-[10px] tracking-[0.3em] uppercase text-cyan-400/60 mb-2">
            {isOnboarding ? `Step ${onboardingStep + 1}: ${ONBOARDING_STEPS[onboardingStep]}` : "Settings"}
          </p>
          <h1 className="font-display text-3xl italic text-white">
            {isOnboarding ? (
              onboardingStep === 0 ? "Set up your profile" :
              onboardingStep === 1 ? "Create or join an org" :
              onboardingStep === 2 ? "Connect your tools" :
              "You're all set"
            ) : "Profile and Org"}
          </h1>
          <p className="text-[11px] text-zinc-600 mt-2 tracking-wide">
            {isOnboarding
              ? "Complete each step to get the most out of Neo."
              : "Manager invites members. Members join by link and add their integration keys."}
          </p>
        </div>

        {/* Done step */}
        {isOnboarding && onboardingStep === 3 && (
          <div className="text-center py-16 space-y-6">
            <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto">
              <span className="text-emerald-400 text-2xl">✓</span>
            </div>
            <div>
              <h2 className="text-xl font-medium text-white">Neo is ready for you</h2>
              <p className="text-[12px] text-zinc-500 mt-2">Your profile, org, and integrations are set up.</p>
            </div>
            <Link
              href="/"
              className="inline-block px-6 py-3 bg-cyan-500/10 border border-cyan-500/20 rounded-xl text-[12px] text-cyan-400 tracking-wider uppercase hover:bg-cyan-500/20 transition-all"
            >
              Talk to Neo →
            </Link>
          </div>
        )}

        {/* Onboarding next/skip buttons */}
        {isOnboarding && onboardingStep < 3 && onboardingStep > 0 && (
          <div className="flex items-center gap-3 mb-6">
            <button
              onClick={() => setOnboardingStep((s) => Math.max(0, s - 1) as OnboardingStep)}
              className="text-[10px] tracking-wider uppercase text-zinc-600 hover:text-zinc-400 transition-colors"
            >
              ← Back
            </button>
            <button
              onClick={() => setOnboardingStep((s) => Math.min(3, s + 1) as OnboardingStep)}
              className="text-[10px] tracking-wider uppercase text-zinc-500 hover:text-zinc-300 transition-colors ml-auto"
            >
              Skip this step →
            </button>
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="border border-zinc-800 bg-zinc-950/70 rounded-2xl p-5">
            <p className="text-[10px] tracking-[0.25em] uppercase text-cyan-400/70">Personal Profile</p>
            <div className="mt-4 space-y-3">
              <label className="block">
                <span className="text-[11px] text-zinc-500">Display Name</span>
                <input
                  className="mt-1 w-full rounded-lg border border-zinc-800 bg-black/70 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-cyan-500/50"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Your name"
                />
              </label>
              <label className="block">
                <span className="text-[11px] text-zinc-500">Work Gmail / Work Email</span>
                <input
                  className="mt-1 w-full rounded-lg border border-zinc-800 bg-black/70 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-cyan-500/50"
                  value={workEmail}
                  onChange={(e) => setWorkEmail(e.target.value)}
                  placeholder="name@company.com"
                />
              </label>
              <button
                type="button"
                onClick={saveProfile}
                disabled={busy}
                className="px-4 py-2 rounded-lg border border-cyan-600/40 bg-cyan-500/10 text-cyan-300 text-xs uppercase tracking-[0.18em] disabled:opacity-40"
              >
                Save Profile
              </button>
            </div>
          </section>

          <section className="border border-zinc-800 bg-zinc-950/70 rounded-2xl p-5">
            <p className="text-[10px] tracking-[0.25em] uppercase text-cyan-400/70">Organization</p>

            {!org.org ? (
              <div className="mt-4 space-y-3">
                <input
                  className="w-full rounded-lg border border-zinc-800 bg-black/70 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-cyan-500/50"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  placeholder="Org name"
                />
                <button
                  type="button"
                  onClick={createOrg}
                  disabled={busy || !orgName.trim()}
                  className="px-4 py-2 rounded-lg border border-cyan-600/40 bg-cyan-500/10 text-cyan-300 text-xs uppercase tracking-[0.18em] disabled:opacity-40"
                >
                  Create Org
                </button>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                <div className="text-sm text-zinc-200">
                  <span className="text-zinc-500">Org:</span> {org.org.name}
                </div>
                <div className="text-xs text-zinc-500 uppercase tracking-[0.18em]">Role: {org.me?.role}</div>

                {isManager && (
                  <button
                    type="button"
                    onClick={generateInvite}
                    disabled={busy}
                    className="px-4 py-2 rounded-lg border border-cyan-600/40 bg-cyan-500/10 text-cyan-300 text-xs uppercase tracking-[0.18em] disabled:opacity-40"
                  >
                    Generate Invite Link
                  </button>
                )}

                {inviteLink && (
                  <div className="rounded-lg border border-zinc-800 bg-black/70 p-3">
                    <p className="text-[10px] text-zinc-500 uppercase tracking-[0.2em] mb-1">Latest Invite Link</p>
                    <p className="text-xs text-cyan-300 break-all">{inviteLink}</p>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>

        {org.org && (
          <section className="mt-6 border border-zinc-800 bg-zinc-950/70 rounded-2xl p-5">
            <p className="text-[10px] tracking-[0.25em] uppercase text-cyan-400/70">Team Members</p>
            <div className="mt-3 space-y-2">
              {org.members.length === 0 ? (
                <p className="text-xs text-zinc-500">No members yet.</p>
              ) : (
                org.members.map((m) => (
                  <div key={m.userId} className="rounded-lg border border-zinc-800 bg-black/60 px-3 py-2 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm text-zinc-200">{m.name || m.userId}</p>
                      <p className="text-xs text-zinc-500">{m.workEmail || m.email || "No work email"}</p>
                    </div>
                    <span className="text-[10px] uppercase tracking-[0.2em] text-cyan-400/80">{m.role}</span>
                  </div>
                ))
              )}
            </div>
          </section>
        )}

        <div className="mt-10">
          <p className="text-[10px] tracking-[0.25em] uppercase text-cyan-400/70 mb-3">Integrations</p>
          <div className="grid gap-[6px] sm:grid-cols-2">
            {INTEGRATIONS.map((integration) => (
              <ConnectionCard
                key={integration}
                integration={integration}
                connected={connected[integration]}
                accountName={accountNames[integration]}
                onConnect={() => handleConnect(integration)}
                onDisconnect={() => handleDisconnect(integration)}
              />
            ))}
          </div>

          {editorIntegration && (
            <div className="mt-4 rounded-xl border border-zinc-800 bg-black/70 p-4">
              <p className="text-[10px] tracking-[0.2em] uppercase text-cyan-400/70 mb-2">
                {editorIntegration === "calendar" ? "Connect Nylas" : `Connect ${editorIntegration}`}
              </p>
              <p className="text-xs text-zinc-500 mb-3">{integrationHelp}</p>
              {editorIntegration === "jira" && (
                <div className="space-y-2 mb-2">
                  <input
                    type="text"
                    value={jiraDomain}
                    onChange={(e) => setJiraDomain(e.target.value)}
                    placeholder="your-org (from your-org.atlassian.net)"
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-cyan-500/50"
                  />
                  <input
                    type="email"
                    value={jiraEmail}
                    onChange={(e) => setJiraEmail(e.target.value)}
                    placeholder="email@company.com (Jira login)"
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-cyan-500/50"
                  />
                </div>
              )}
              <input
                type="password"
                value={editorToken}
                onChange={(e) => setEditorToken(e.target.value)}
                placeholder={KEY_PLACEHOLDERS[editorIntegration]}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-cyan-500/50"
              />
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={saveIntegrationToken}
                  disabled={busy || !editorToken.trim()}
                  className="px-4 py-2 rounded-lg border border-cyan-600/40 bg-cyan-500/10 text-cyan-300 text-xs uppercase tracking-[0.18em] disabled:opacity-40"
                >
                  Save Key
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditorIntegration(null);
                    setEditorToken("");
                    setJiraDomain("");
                    setJiraEmail("");
                  }}
                  className="px-4 py-2 rounded-lg border border-zinc-700 text-zinc-300 text-xs uppercase tracking-[0.18em]"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Onboarding: continue to done */}
          {isOnboarding && onboardingStep === 2 && (
            <button
              type="button"
              onClick={() => setOnboardingStep(3)}
              className="mt-4 px-5 py-2.5 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-[11px] tracking-wider uppercase hover:bg-cyan-500/20 transition-all"
            >
              Continue →
            </button>
          )}
        </div>

        {message && <p className="mt-4 text-xs text-cyan-300">{message}</p>}

        {/* Onboarding step-specific continue buttons */}
        {isOnboarding && onboardingStep === 0 && (
          <button
            type="button"
            onClick={() => setOnboardingStep(1)}
            className="mt-6 px-5 py-2.5 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-[11px] tracking-wider uppercase hover:bg-cyan-500/20 transition-all"
          >
            Continue to Org →
          </button>
        )}
        {isOnboarding && onboardingStep === 1 && (
          <button
            type="button"
            onClick={() => setOnboardingStep(2)}
            className="mt-6 px-5 py-2.5 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-[11px] tracking-wider uppercase hover:bg-cyan-500/20 transition-all"
          >
            Continue to Integrations →
          </button>
        )}
      </div>
    </div>
  );
}
