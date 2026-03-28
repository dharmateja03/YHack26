"use client";

import { useState, useEffect } from "react";
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
  const [connected, setConnected] = useState<ConnectedState>({
    github: false,
    slack: false,
    jira: false,
    calendar: false,
  });
  const [accountNames, setAccountNames] = useState<AccountNames>({});

  useEffect(() => {
    fetch("/api/users/me")
      .then((r) => r.json())
      .then((data) => {
        if (data.connected) setConnected(data.connected);
        if (data.accountNames) setAccountNames(data.accountNames);
      })
      .catch(() => {});
  }, []);

  const handleConnect = async (integration: string) => {
    const res = await fetch(`/api/auth/connect/${integration}`, { method: "POST" });
    const data = await res.json();
    if (data.redirectUrl) window.location.href = data.redirectUrl;
  };

  const handleDisconnect = async (integration: string) => {
    await fetch(`/api/auth/disconnect/${integration}`, { method: "DELETE" });
    setConnected((prev) => ({ ...prev, [integration]: false }));
    setAccountNames((prev) => ({ ...prev, [integration]: undefined }));
  };

  return (
    <div className="max-w-lg mx-auto px-6 py-12">
      <h1 className="text-xl font-semibold mb-8">Connections</h1>
      <div className="grid gap-4">
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
    </div>
  );
}
