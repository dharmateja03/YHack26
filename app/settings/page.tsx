"use client";

import { useState, useEffect } from "react";
import { useUser } from "@auth0/nextjs-auth0/client";
import { useRouter } from "next/navigation";
import ConnectionCard from "@/components/ConnectionCard";

interface ConnectedState {
  github: boolean;
  slack: boolean;
  jira: boolean;
  calendar: boolean;
}

interface AccountNames {
  github?: string;
  slack?: string;
  jira?: string;
  calendar?: string;
}

const INTEGRATIONS = ["github", "slack", "jira", "calendar"] as const;

export default function SettingsPage() {
  const { user, isLoading } = useUser();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !user) router.replace("/login");
  }, [user, isLoading, router]);

  const [connected, setConnected] = useState<ConnectedState>({
    github: false, slack: false, jira: false, calendar: false,
  });
  const [accountNames, setAccountNames] = useState<AccountNames>({});

  useEffect(() => {
    fetch("/api/users/me")
      .then(r => r.json())
      .then(data => {
        if (data.connected)    setConnected(data.connected);
        if (data.accountNames) setAccountNames(data.accountNames);
      })
      .catch(() => {});
  }, []);

  const handleConnect = async (integration: string) => {
    const res  = await fetch(`/api/auth/connect/${integration}`, { method: "POST" });
    const data = await res.json();
    if (data.redirectUrl) window.location.href = data.redirectUrl;
  };

  const handleDisconnect = async (integration: string) => {
    await fetch(`/api/auth/disconnect/${integration}`, { method: "DELETE" });
    setConnected(prev => ({ ...prev, [integration]: false }));
    setAccountNames(prev => ({ ...prev, [integration]: undefined }));
  };

  if (isLoading || !user) return null;

  return (
    <div className="relative min-h-[calc(100vh-65px)] px-6 py-16 overflow-hidden">

      {/* Background grid */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.025]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(6,182,212,1) 1px, transparent 1px), linear-gradient(90deg, rgba(6,182,212,1) 1px, transparent 1px)",
          backgroundSize: "60px 60px",
        }}
      />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_0%,transparent_40%,black_100%)]" />

      <div className="relative z-10 max-w-md mx-auto">
        {/* Header */}
        <div className="mb-10">
          <p className="text-[10px] tracking-[0.3em] uppercase text-cyan-400/60 mb-2">Settings</p>
          <h1 className="font-display text-3xl italic text-white">Connections</h1>
          <p className="text-[11px] text-zinc-600 mt-2 tracking-wide">
            Connect your tools — Neo reads them automatically.
          </p>
        </div>

        {/* Cards */}
        <div className="flex flex-col gap-[6px]">
          {INTEGRATIONS.map((integration, i) => (
            <div
              key={integration}
              className="fade-up"
              style={{ animationDelay: `${i * 0.07}s`, opacity: 0 }}
            >
              <ConnectionCard
                integration={integration}
                connected={connected[integration]}
                accountName={accountNames[integration]}
                onConnect={() => handleConnect(integration)}
                onDisconnect={() => handleDisconnect(integration)}
              />
            </div>
          ))}
        </div>

        {/* Footer note */}
        <p className="text-[10px] text-zinc-700 mt-8 tracking-wide text-center">
          OAuth tokens are stored securely via Auth0 — Neo only reads, never writes.
        </p>
      </div>
    </div>
  );
}
