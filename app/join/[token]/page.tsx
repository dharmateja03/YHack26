"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

type JoinState = "idle" | "joining" | "success" | "error";
type AuthMode = "signup" | "login";

interface SessionUserLite {
  userId: string;
  name?: string;
  email?: string;
}

export default function JoinOrgPage() {
  const params = useParams<{ token: string }>();
  const token = useMemo(() => String(params?.token ?? ""), [params]);

  const [sessionUser, setSessionUser] = useState<SessionUserLite | null>(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>("signup");

  const [state, setState] = useState<JoinState>("idle");
  const [message, setMessage] = useState<string>("");
  const [orgName, setOrgName] = useState<string>("");
  const [authName, setAuthName] = useState<string>("");
  const [authEmail, setAuthEmail] = useState<string>("");
  const [authPassword, setAuthPassword] = useState<string>("");
  const hasJoinedRef = useRef(false);

  const joinInvite = async (opts?: { name?: string; email?: string; userId?: string }) => {
    if (!token || hasJoinedRef.current) return;

    hasJoinedRef.current = true;
    setState("joining");
    setMessage("");
    const res = await fetch("/api/orgs/invites/redeem", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token,
        userId: opts?.userId ?? sessionUser?.userId,
        name: opts?.name ?? sessionUser?.name,
        email: opts?.email ?? sessionUser?.email,
      }),
    }).catch(() => null);

    if (!res) {
      hasJoinedRef.current = false;
      setState("error");
      setMessage("Failed to join org.");
      return;
    }

    const data = await res.json().catch(() => null);
    if (!res.ok) {
      hasJoinedRef.current = false;
      setState("error");
      setMessage(data?.error ?? "Failed to join org.");
      return;
    }

    setState("success");
    setOrgName(data?.org?.name ?? "your organization");
    setMessage("You have joined successfully.");
  };

  useEffect(() => {
    let cancelled = false;
    fetch("/api/users/me?lite=1", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (data?.userId) {
          setSessionUser({
            userId: String(data.userId),
            name: typeof data.name === "string" ? data.name : undefined,
            email: typeof data.email === "string" ? data.email : undefined,
          });
        } else {
          setSessionUser(null);
        }
      })
      .catch(() => {
        if (!cancelled) setSessionUser(null);
      })
      .finally(() => {
        if (!cancelled) setSessionChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!sessionChecked || !token || !sessionUser || hasJoinedRef.current) return;
    void joinInvite();
  }, [sessionChecked, token, sessionUser?.userId]);

  const createAccountAndJoin = async () => {
    if (!authName.trim() || !authEmail.trim() || !authPassword.trim()) return;
    setState("joining");
    setMessage("");

    const endpoint = authMode === "signup" ? "/api/auth/basic/signup" : "/api/auth/basic/login";
    const payload =
      authMode === "signup"
        ? {
            name: authName.trim(),
            email: authEmail.trim(),
            password: authPassword,
            inviteToken: token,
          }
        : {
            email: authEmail.trim(),
            password: authPassword,
            inviteToken: token,
          };

    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => null);

    if (!res) {
      setState("error");
      setMessage("Failed to join org.");
      return;
    }

    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setState("error");
      setMessage(data?.error ?? "Failed to join org.");
      return;
    }

    const user = data?.user;
    if (user?.userId) {
      setSessionUser({
        userId: String(user.userId),
        name: typeof user.name === "string" ? user.name : undefined,
        email: typeof user.email === "string" ? user.email : undefined,
      });
    }

    if (data?.joined && data?.org) {
      hasJoinedRef.current = true;
      setState("success");
      setOrgName(data.org?.name ?? "your organization");
      setMessage("Account created and joined successfully.");
      return;
    }

    // Fallback: if account created/login worked but invite join wasn't done upstream.
    hasJoinedRef.current = false;
    await joinInvite({
      userId: user?.userId,
      name: user?.name,
      email: user?.email,
    });
  };

  return (
    <div className="relative min-h-[calc(100vh-65px)] px-6 py-16 overflow-hidden">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(6,182,212,1) 1px, transparent 1px), linear-gradient(90deg, rgba(6,182,212,1) 1px, transparent 1px)",
          backgroundSize: "60px 60px",
        }}
      />

      <div className="relative z-10 max-w-lg mx-auto border border-zinc-800 bg-zinc-950/80 rounded-2xl p-8">
        <p className="text-[10px] tracking-[0.25em] uppercase text-cyan-400/70 mb-2">Organization Invite</p>
        <h1 className="font-display text-3xl italic text-white">Join Team</h1>

        <div className="mt-6 space-y-3">
          {!sessionUser && state !== "success" && (
            <div className="space-y-3">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setAuthMode("signup")}
                  className={`px-3 py-1.5 rounded-md text-[10px] uppercase tracking-[0.16em] border ${
                    authMode === "signup"
                      ? "border-cyan-500/50 text-cyan-300 bg-cyan-500/10"
                      : "border-zinc-700 text-zinc-400"
                  }`}
                >
                  Create Account
                </button>
                <button
                  type="button"
                  onClick={() => setAuthMode("login")}
                  className={`px-3 py-1.5 rounded-md text-[10px] uppercase tracking-[0.16em] border ${
                    authMode === "login"
                      ? "border-cyan-500/50 text-cyan-300 bg-cyan-500/10"
                      : "border-zinc-700 text-zinc-400"
                  }`}
                >
                  Login
                </button>
              </div>
              <p className="text-sm text-zinc-400">
                {authMode === "signup"
                  ? "Create account and join this organization in one step."
                  : "Login and join this organization."}
              </p>
              {authMode === "signup" && (
                <input
                  value={authName}
                  onChange={(e) => setAuthName(e.target.value)}
                  placeholder="Your name"
                  className="w-full rounded-lg border border-zinc-800 bg-black/70 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-cyan-500/50"
                />
              )}
              <input
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
                placeholder="you@company.com"
                className="w-full rounded-lg border border-zinc-800 bg-black/70 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-cyan-500/50"
              />
              <input
                type="password"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                placeholder="Password"
                className="w-full rounded-lg border border-zinc-800 bg-black/70 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-cyan-500/50"
              />
              <button
                type="button"
                disabled={
                  state === "joining" ||
                  !authEmail.trim() ||
                  !authPassword.trim() ||
                  (authMode === "signup" && !authName.trim())
                }
                onClick={() => void createAccountAndJoin()}
                className="inline-flex px-4 py-2 rounded-lg border border-cyan-600/40 bg-cyan-500/10 text-cyan-300 text-xs uppercase tracking-[0.18em] disabled:opacity-40"
              >
                {authMode === "signup" ? "Create Account & Join" : "Login & Join"}
              </button>
            </div>
          )}
          {state === "joining" && <p className="text-sm text-zinc-300">Joining organization...</p>}
          {state === "error" && <p className="text-sm text-red-300">{message}</p>}
          {state === "success" && (
            <>
              <p className="text-sm text-cyan-300">{message}</p>
              <p className="text-xs text-zinc-500">You are now in {orgName}. Connect your tools to get started.</p>
              <Link
                href="/settings?onboarding=1"
                className="inline-flex px-4 py-2 rounded-lg border border-cyan-600/40 bg-cyan-500/10 text-cyan-300 text-xs uppercase tracking-[0.18em]"
              >
                Set up integrations →
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
