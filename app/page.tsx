"use client";

import { useState, useEffect } from "react";
import AgentCard from "@/components/AgentCard";
import VoicePlayer from "@/components/VoicePlayer";

interface AgentStatus {
  name: string;
  lastRun: string | null;
  status: "idle" | "running" | "error";
}

const INITIAL_AGENTS: AgentStatus[] = [
  { name: "Neo Brief", lastRun: null, status: "idle" },
  { name: "Neo PR", lastRun: null, status: "idle" },
  { name: "Neo Sched", lastRun: null, status: "idle" },
  { name: "Neo Root", lastRun: null, status: "idle" },
  { name: "Neo Sprint", lastRun: null, status: "idle" },
];

export default function HomePage() {
  const [listening, setListening] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [agents, setAgents] = useState<AgentStatus[]>(INITIAL_AGENTS);

  const handleTalkToNeo = () => {
    if (!("webkitSpeechRecognition" in window) && !("SpeechRecognition" in window)) {
      alert("Speech recognition is not supported in this browser.");
      return;
    }

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    setListening(true);

    recognition.onresult = async (event: any) => {
      const transcript = event.results[0][0].transcript.toLowerCase();
      setListening(false);
      await routeTranscript(transcript);
    };

    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);
    recognition.start();
  };

  const routeTranscript = async (transcript: string) => {
    let endpoint = "/api/agents/brief";

    if (transcript.includes("schedule") || transcript.includes("meet")) {
      endpoint = "/api/agents/schedule/find";
    } else if (transcript.includes("why") || transcript.includes("blocked") || transcript.includes("root")) {
      endpoint = "/api/agents/rootcause";
    } else if (transcript.includes("sprint") || transcript.includes("forecast")) {
      endpoint = "/api/agents/sprint/forecast";
    } else if (transcript.includes("pr") || transcript.includes("pull request") || transcript.includes("review")) {
      endpoint = "/api/agents/pr/scan";
    }

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "audio/mpeg" },
        body: JSON.stringify({ transcript }),
      });

      if (res.headers.get("content-type")?.includes("audio")) {
        const blob = await res.blob();
        setAudioUrl(URL.createObjectURL(blob));
      }
    } catch {
      // silent fail — agent responded without audio
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-65px)] px-6 pb-24">
      {/* Main CTA */}
      <button
        onClick={handleTalkToNeo}
        disabled={listening}
        className={`w-48 h-48 rounded-full text-lg font-semibold transition-all shadow-2xl
          ${listening
            ? "bg-indigo-500 scale-95 animate-pulse cursor-not-allowed"
            : "bg-indigo-600 hover:bg-indigo-500 hover:scale-105 active:scale-95"
          }`}
      >
        {listening ? "Listening…" : "Talk to Neo"}
      </button>

      {/* Agent status cards */}
      <div className="mt-14 w-full max-w-xl grid gap-3">
        {agents.map((agent) => (
          <AgentCard
            key={agent.name}
            name={agent.name}
            lastRun={agent.lastRun}
            status={agent.status}
          />
        ))}
      </div>

      {/* Voice player — visible only when audio is active */}
      <VoicePlayer audioUrl={audioUrl} />
    </div>
  );
}
