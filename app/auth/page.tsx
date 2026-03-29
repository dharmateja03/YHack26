"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Mode = "signup" | "login";

interface SessionUserLite {
  userId: string;
  name?: string;
  email?: string;
}

export default function AuthPage() {
  const [mode, setMode] = useState<Mode>("login");
  const [user, setUser] = useState<SessionUserLite | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const loadSession = async () => {
    const res = await fetch("/api/users/me?lite=1", { cache: "no-store" }).catch(() => null);
    if (!res?.ok) {
      setUser(null);
      return;
    }
    const data = await res.json().catch(() => null);
    if (!data?.userId) {
      setUser(null);
      return;
    }
    setUser({
      userId: String(data.userId),
      name: typeof data.name === "string" ? data.name : undefined,
      email: typeof data.email === "string" ? data.email : undefined,
    });
  };

  useEffect(() => {
    void loadSession();
  }, []);

  const submit = async () => {
    if (!email.trim() || !password.trim() || (mode === "signup" && !name.trim())) return;
    setBusy(true);
    setMessage(null);

    const endpoint = mode === "signup" ? "/api/auth/basic/signup" : "/api/auth/basic/login";
    const payload =
      mode === "signup"
        ? { name: name.trim(), email: email.trim(), password }
        : { email: email.trim(), password };

    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => null);

    if (!res) {
      setMessage("Request failed.");
      setBusy(false);
      return;
    }

    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setMessage(data?.error ?? "Auth failed");
      setBusy(false);
      return;
    }

    setMessage(mode === "signup" ? "Account created." : "Logged in.");
    await loadSession();
    setBusy(false);
  };

  const logout = async () => {
    setBusy(true);
    setMessage(null);
    await fetch("/api/auth/basic/logout", { method: "POST" }).catch(() => null);
    setUser(null);
    setBusy(false);
  };

  return (
    <div className="relative min-h-[calc(100vh-65px)] px-6 py-16 overflow-hidden">
      <div className="relative z-10 max-w-md mx-auto border border-zinc-800 bg-zinc-950/80 rounded-2xl p-8">
        <p className="text-[10px] tracking-[0.25em] uppercase text-cyan-400/70 mb-2">Account</p>
        <h1 className="font-display text-3xl italic text-white">Login or Create Account</h1>

        {user ? (
          <div className="mt-6 space-y-4">
            <p className="text-sm text-zinc-300">
              Logged in as <span className="text-cyan-300">{user.email ?? user.userId}</span>
            </p>
            <div className="flex gap-2">
              <Link
                href="/settings"
                className="inline-flex px-4 py-2 rounded-lg border border-cyan-600/40 bg-cyan-500/10 text-cyan-300 text-xs uppercase tracking-[0.18em]"
              >
                Open Settings
              </Link>
              <button
                type="button"
                onClick={logout}
                disabled={busy}
                className="inline-flex px-4 py-2 rounded-lg border border-zinc-700 text-zinc-300 text-xs uppercase tracking-[0.18em] disabled:opacity-40"
              >
                Logout
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-6 space-y-3">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setMode("login")}
                className={`px-3 py-1.5 rounded-md text-[10px] uppercase tracking-[0.16em] border ${
                  mode === "login" ? "border-cyan-500/50 text-cyan-300 bg-cyan-500/10" : "border-zinc-700 text-zinc-400"
                }`}
              >
                Login
              </button>
              <button
                type="button"
                onClick={() => setMode("signup")}
                className={`px-3 py-1.5 rounded-md text-[10px] uppercase tracking-[0.16em] border ${
                  mode === "signup"
                    ? "border-cyan-500/50 text-cyan-300 bg-cyan-500/10"
                    : "border-zinc-700 text-zinc-400"
                }`}
              >
                Create Account
              </button>
            </div>
            {mode === "signup" && (
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                className="w-full rounded-lg border border-zinc-800 bg-black/70 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-cyan-500/50"
              />
            )}
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              className="w-full rounded-lg border border-zinc-800 bg-black/70 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-cyan-500/50"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className="w-full rounded-lg border border-zinc-800 bg-black/70 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-cyan-500/50"
            />
            <button
              type="button"
              onClick={submit}
              disabled={busy || !email.trim() || !password.trim() || (mode === "signup" && !name.trim())}
              className="inline-flex px-4 py-2 rounded-lg border border-cyan-600/40 bg-cyan-500/10 text-cyan-300 text-xs uppercase tracking-[0.18em] disabled:opacity-40"
            >
              {mode === "signup" ? "Create Account" : "Login"}
            </button>
          </div>
        )}

        {message && <p className="mt-4 text-xs text-cyan-300">{message}</p>}
      </div>
    </div>
  );
}
