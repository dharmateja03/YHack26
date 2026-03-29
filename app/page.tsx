"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { ConversationProvider, useConversation } from "@elevenlabs/react";
import VoicePlayer from "@/components/VoicePlayer";

// ── Types ──────────────────────────────────────────────────────────────────────

interface AgentStatus {
  name: string;
  key: string;
  lastRun: string | null;
  status: "idle" | "running" | "error";
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  agent?: string;
  timestamp: string;
  isStreaming?: boolean;
}

interface SessionMeta {
  sessionId: string;
  title: string;
  preview: string;
  updatedAt: string;
  messageCount: number;
}

interface LiveConnectionInfo {
  signedUrl: string | null;
  agentId: string | null;
  warning?: string;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const INITIAL_AGENTS: AgentStatus[] = [
  { name: "Neo Brief",  key: "brief",  lastRun: null, status: "idle" },
  { name: "Neo PR",     key: "pr",     lastRun: null, status: "idle" },
  { name: "Neo Sched",  key: "sched",  lastRun: null, status: "idle" },
  { name: "Neo Root",   key: "root",   lastRun: null, status: "idle" },
  { name: "Neo Sprint", key: "sprint", lastRun: null, status: "idle" },
];

const DEFAULT_USER_ID = "user-1";

const AGENT_KEY_MAP: Record<string, string> = {
  "neo-chat": "brief", "neo-brief": "brief", "neo-pr": "pr",
  "neo-sched": "sched", "neo-root": "root", "neo-sprint": "sprint",
};

const AGENT_LABELS: Record<string, string> = {
  "neo-chat": "Neo", "neo-brief": "Neo Brief", "neo-pr": "Neo PR",
  "neo-sched": "Neo Sched", "neo-root": "Neo Root", "neo-sprint": "Neo Sprint",
};

const THINKING_PHRASES = [
  "Pulling context…", "Checking your data…", "Scanning PRs…",
  "Thinking…", "Connecting the dots…", "Analyzing…",
];

const ORG_INFO_INTENT = /\b(tell me about|who(?:'s| is)|team members|teammates|my team|our team|member)\b/i;

function generateSessionId() {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeAsrTranscript(text: string): string {
  let t = text.trim().replace(/^neo[,\s]+/i, "").trim();
  t = t
    .replace(/\bi'm\b/gi, "I am").replace(/\bdon't\b/gi, "do not")
    .replace(/\bcan't\b/gi, "cannot").replace(/\bwon't\b/gi, "will not")
    .replace(/\bwanna\b/gi, "want to").replace(/\bgonna\b/gi, "going to");
  const hourWords: Record<string, string> = {
    one:"1",two:"2",three:"3",four:"4",five:"5",six:"6",
    seven:"7",eight:"8",nine:"9",ten:"10",eleven:"11",twelve:"12",
  };
  for (const [word, digit] of Object.entries(hourWords)) {
    t = t.replace(new RegExp(`\\b${word}\\s+(am|pm)\\b`, "gi"), `${digit} $1`);
  }
  return t.replace(/(\d{1,2})\s+o'?clock\b/gi, "$1:00").replace(/\s+/g, " ").trim();
}

function groupSessionsByDate(sessions: SessionMeta[]): { label: string; items: SessionMeta[] }[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterday = today - 86400000;
  const week = today - 6 * 86400000;
  const month = today - 29 * 86400000;

  const groups: Record<string, SessionMeta[]> = { Today: [], Yesterday: [], "This week": [], "This month": [], Older: [] };
  for (const s of sessions) {
    const t = new Date(s.updatedAt).getTime();
    if (t >= today) groups["Today"].push(s);
    else if (t >= yesterday) groups["Yesterday"].push(s);
    else if (t >= week) groups["This week"].push(s);
    else if (t >= month) groups["This month"].push(s);
    else groups["Older"].push(s);
  }
  return Object.entries(groups)
    .filter(([, items]) => items.length > 0)
    .map(([label, items]) => ({ label, items }));
}

// ── Root export ────────────────────────────────────────────────────────────────

export default function HomePage() {
  return (
    <ConversationProvider>
      <HomePageContent />
    </ConversationProvider>
  );
}

// ── Main content ───────────────────────────────────────────────────────────────

function HomePageContent() {
  const [audioUrl, setAudioUrl]         = useState<string | null>(null);
  const [agents, setAgents]             = useState<AgentStatus[]>(INITIAL_AGENTS);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [textInput, setTextInput]       = useState("");
  const [sending, setSending]           = useState(false);
  const [sessionId, setSessionId]       = useState(() => generateSessionId());
  const [currentUserId, setCurrentUserId] = useState(DEFAULT_USER_ID);
  const [thinkingAgent, setThinkingAgent] = useState<string | null>(null);
  const [thinkingPhrase, setThinkingPhrase] = useState("Thinking…");
  const chatEndRef                      = useRef<HTMLDivElement>(null);
  const streamAbortRef                  = useRef(false);

  // Sidebar state
  const [sidebarOpen, setSidebarOpen]   = useState(true);
  const [sessions, setSessions]         = useState<SessionMeta[]>([]);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sidebarDeleting, setSidebarDeleting] = useState<string | null>(null);

  // Voice state
  const [liveConnectionError, setLiveConnectionError] = useState<string | null>(null);
  const [pendingVoiceText, setPendingVoiceText] = useState("");
  const [vadScore, setVadScore]         = useState(0);
  const [suppressConvAiAudio, setSuppressConvAiAudio] = useState(false);
  const lastSentVoiceSigRef             = useRef("");
  const lastBargeInAtRef                = useRef(0);
  const speechEpochRef                  = useRef(0);
  const wasUserSpeakingRef              = useRef(false);

  // ── ElevenLabs conversation hook ─────────────────────────────────────────────
  const conversation = useConversation({
    volume: 1,
    onConnect:    () => { setLiveConnectionError(null); },
    onDisconnect: () => {
      setPendingVoiceText(""); lastSentVoiceSigRef.current = "";
      speechEpochRef.current = 0; wasUserSpeakingRef.current = false;
      setSuppressConvAiAudio(false);
      setAgents(prev => prev.map(a => a.status === "running" ? { ...a, status: "idle" } : a));
    },
    onError:   (message) => setLiveConnectionError(message || "Voice connection failed."),
    onMessage: ({ role, message }) => { if (role === "user") setPendingVoiceText(message); },
    onVadScore: (event: any) => {
      const score = Number(event?.vad_score_event?.vad_score ?? 0);
      setVadScore(Number.isFinite(score) ? score : 0);
    },
  });

  const liveConnected  = conversation.status === "connected";
  const liveConnecting = conversation.status === "connecting";
  const listening      = liveConnected && conversation.isListening;

  // ── Effects ───────────────────────────────────────────────────────────────────

  // VAD barge-in & volume control
  useEffect(() => {
    if (!liveConnected) return;
    const userIsSpeaking = vadScore > 0.45;
    if (userIsSpeaking && !wasUserSpeakingRef.current) speechEpochRef.current += 1;
    wasUserSpeakingRef.current = userIsSpeaking;
    const now = Date.now();
    if (userIsSpeaking && conversation.isSpeaking && now - lastBargeInAtRef.current > 250) {
      lastBargeInAtRef.current = now;
      try { conversation.sendUserActivity(); } catch {}
    }
    try { conversation.setVolume({ volume: suppressConvAiAudio ? 0 : (userIsSpeaking ? 0 : 1) }); } catch {}
  }, [conversation, liveConnected, vadScore, conversation.isSpeaking, suppressConvAiAudio]);

  // Clear audio when voice connects
  useEffect(() => {
    if (!liveConnected && !liveConnecting) return;
    setAudioUrl(prev => { if (prev) URL.revokeObjectURL(prev); return null; });
  }, [liveConnected, liveConnecting]);

  // ASR debounce + normalization
  useEffect(() => {
    if (!liveConnected) return;
    const text = pendingVoiceText.trim();
    if (!text) return;
    const normalized = text.toLowerCase().replace(/\s+/g, " ").replace(/[.!?,;:]+$/g, "").trim();
    const voiceSig = `${normalized}::${speechEpochRef.current}`;
    if (voiceSig === lastSentVoiceSigRef.current || sending) return;

    const t = setTimeout(() => {
      const stabilized = pendingVoiceText.trim();
      if (!stabilized) return;
      const cleaned = normalizeAsrTranscript(stabilized);
      const sig = `${cleaned.toLowerCase().replace(/\s+/g," ").replace(/[.!?,;:]+$/g,"").trim()}::${speechEpochRef.current}`;
      if (sig === lastSentVoiceSigRef.current) return;

      const wordCount = cleaned.trim().split(/\s+/).length;
      const isClearCommand = /\b(yes|no|yeah|nah|ok|okay|schedule|brief|pr|sprint|check)\b/i.test(cleaned);
      if (wordCount < 4 && !isClearCommand) {
        try { conversation.sendUserMessage(`Did you say: "${cleaned}"?`); } catch {}
        return;
      }
      lastSentVoiceSigRef.current = sig;
      setPendingVoiceText("");
      void sendMessage(cleaned);
    }, 900);
    return () => clearTimeout(t);
  }, [liveConnected, pendingVoiceText, sending, conversation]);

  // Auto-scroll
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatMessages]);

  // Load current user
  useEffect(() => {
    let cancelled = false;
    fetch("/api/users/me").then(r => r.ok ? r.json() : null).then(data => {
      if (!cancelled && typeof data?.userId === "string" && data.userId.trim())
        setCurrentUserId(data.userId.trim());
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Load session list
  useEffect(() => {
    if (sessionsLoaded) return;
    const load = async () => {
      try {
        const res = await fetch(`/api/agents/chat/sessions?userId=${currentUserId}`);
        if (res.ok) {
          const data = await res.json();
          setSessions(data.sessions ?? []);
        }
      } catch {}
      setSessionsLoaded(true);
    };
    void load();
  }, [currentUserId, sessionsLoaded]);

  // Thinking phrase cycle
  useEffect(() => {
    if (!sending) return;
    let i = 0;
    const interval = setInterval(() => {
      i = (i + 1) % THINKING_PHRASES.length;
      setThinkingPhrase(THINKING_PHRASES[i]);
    }, 1800);
    return () => clearInterval(interval);
  }, [sending]);

  // ── Session management ────────────────────────────────────────────────────────

  const startNewChat = useCallback(() => {
    const newId = generateSessionId();
    setSessionId(newId);
    setActiveSessionId(null);
    setChatMessages([]);
    setAgents(INITIAL_AGENTS);
    setTextInput("");
  }, []);

  const loadSession = useCallback(async (sid: string) => {
    if (sid === sessionId && activeSessionId === sid) return;
    setActiveSessionId(sid);
    setSessionId(sid);
    setChatMessages([]);

    try {
      const res = await fetch(`/api/agents/chat/sessions?sessionId=${sid}`);
      if (!res.ok) return;
      const data = await res.json();
      const turns: ChatMessage[] = (data.turns ?? []).map((t: any) => ({
        role: t.role as "user" | "assistant",
        content: t.content,
        agent: t.agentUsed,
        timestamp: t.timestamp
          ? new Date(t.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
          : "",
      }));
      setChatMessages(turns);
    } catch {}
  }, [sessionId, activeSessionId]);

  const deleteSession = useCallback(async (sid: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSidebarDeleting(sid);
    try {
      await fetch(`/api/agents/chat/sessions?sessionId=${sid}`, { method: "DELETE" });
      setSessions(prev => prev.filter(s => s.sessionId !== sid));
      if (activeSessionId === sid) startNewChat();
    } catch {}
    setSidebarDeleting(null);
  }, [activeSessionId, startNewChat]);

  // Add new session to sidebar after first message
  const upsertSessionInSidebar = useCallback((sid: string, firstMessage: string) => {
    setSessions(prev => {
      const exists = prev.find(s => s.sessionId === sid);
      const meta: SessionMeta = {
        sessionId: sid,
        title: firstMessage.slice(0, 60) + (firstMessage.length > 60 ? "…" : ""),
        preview: "",
        updatedAt: new Date().toISOString(),
        messageCount: 1,
      };
      if (exists) return prev.map(s => s.sessionId === sid ? { ...s, updatedAt: meta.updatedAt, messageCount: s.messageCount + 1 } : s);
      return [meta, ...prev];
    });
  }, []);

  // ── Send message ──────────────────────────────────────────────────────────────

  const sendMessage = async (text: string) => {
    if (!text.trim() || sending) return;

    const isOrgInfo = ORG_INFO_INTENT.test(text);
    const wantsAudio = (!liveConnected && !liveConnecting) || isOrgInfo;

    if (isOrgInfo && liveConnected) {
      setSuppressConvAiAudio(true);
      try { conversation.sendUserActivity(); } catch {}
      setTimeout(() => setSuppressConvAiAudio(false), 5000);
    }

    setSending(true);
    setThinkingAgent(null);

    const isFirstMsg = chatMessages.filter(m => m.role === "user").length === 0;
    if (isFirstMsg) {
      upsertSessionInSidebar(sessionId, text);
      setActiveSessionId(sessionId);
    }

    const userMsg: ChatMessage = {
      role: "user", content: text,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };
    setChatMessages(prev => [...prev, userMsg]);

    const t = text.toLowerCase();
    let guessedAgent = "neo-chat";
    if (t.includes("schedule") || t.includes("meet") || t.includes("book")) guessedAgent = "neo-sched";
    else if (t.includes("why") || t.includes("blocked") || t.includes("root cause")) guessedAgent = "neo-root";
    else if (t.includes("sprint") || t.includes("forecast") || t.includes("velocity")) guessedAgent = "neo-sprint";
    else if (t.includes("pr") || t.includes("pull request") || t.includes("review")) guessedAgent = "neo-pr";
    else if (t.includes("brief") || t.includes("morning") || t.includes("evening")) guessedAgent = "neo-brief";

    setThinkingAgent(guessedAgent);
    setAgents(prev => prev.map(a => a.key === (AGENT_KEY_MAP[guessedAgent] ?? "brief") ? { ...a, status: "running" } : a));

    try {
      const res = await fetch("/api/agents/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: wantsAudio ? "audio/mpeg, application/json" : "application/json" },
        body: JSON.stringify({ message: text, sessionId, userId: currentUserId }),
      });

      if (!res.ok) throw new Error(`${res.status}`);
      const contentType = res.headers.get("content-type") ?? "";
      let reply = "";
      let resolvedAgent = guessedAgent;

      if (wantsAudio && contentType.includes("audio")) {
        const encodedReply = res.headers.get("X-Neo-Reply");
        const encodedAgent = res.headers.get("X-Neo-Agent");
        try { reply = encodedReply ? decodeURIComponent(encodedReply) : ""; } catch { reply = ""; }
        resolvedAgent = encodedAgent ?? guessedAgent;
        void res.blob().then(blob => {
          setAudioUrl(prev => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(blob); });
        }).catch(() => {});
      } else {
        const data = await res.json();
        reply = data?.reply ?? "";
        resolvedAgent = data?.agent ?? guessedAgent;
      }

      if (!reply.trim()) reply = "I couldn't generate a response right now. Try again.";

      const agentKey = AGENT_KEY_MAP[resolvedAgent] ?? "brief";
      setAgents(prev => prev.map(a => {
        if (a.key === agentKey || a.key === (AGENT_KEY_MAP[guessedAgent] ?? "brief"))
          return { ...a, status: "idle", lastRun: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) };
        return a.status === "running" ? { ...a, status: "idle" } : a;
      }));

      setChatMessages(prev => [...prev, {
        role: "assistant", content: reply, agent: resolvedAgent,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      }]);
      streamAbortRef.current = false;

    } catch {
      setAgents(prev => prev.map(a => a.status === "running" ? { ...a, status: "error" } : a));
      setTimeout(() => setAgents(prev => prev.map(a => a.status === "error" ? { ...a, status: "idle" } : a)), 2000);
      setChatMessages(prev => [...prev, {
        role: "assistant", content: "Something went wrong. Try again.",
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      }]);
    } finally {
      setSending(false);
      setThinkingAgent(null);
    }
  };

  // ── Voice ─────────────────────────────────────────────────────────────────────

  const getLiveConnectionInfo = useCallback(async (): Promise<LiveConnectionInfo | null> => {
    try {
      const res = await fetch("/api/elevenlabs/signed-url");
      if (!res.ok) return null;
      const data = await res.json().catch(() => ({}));
      return {
        signedUrl: typeof data?.signedUrl === "string" ? data.signedUrl : null,
        agentId:   typeof data?.agentId   === "string" ? data.agentId   : null,
        warning:   typeof data?.warning   === "string" ? data.warning   : undefined,
      };
    } catch { return null; }
  }, []);

  const handleVoiceInput = useCallback(async () => {
    setLiveConnectionError(null);
    if (liveConnected) {
      conversation.endSession();
      setPendingVoiceText(""); lastSentVoiceSigRef.current = "";
      speechEpochRef.current = 0; wasUserSpeakingRef.current = false;
      return;
    }
    if (liveConnecting) return;
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      const conn = await getLiveConnectionInfo();
      if (conn?.signedUrl) { conversation.startSession({ signedUrl: conn.signedUrl }); return; }
      if (conn?.agentId)   { conversation.startSession({ agentId: conn.agentId, connectionType: "webrtc" }); return; }
      const agentId = process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID;
      if (!agentId) throw new Error("Live voice not configured.");
      conversation.startSession({ agentId, connectionType: "webrtc" });
    } catch (error: any) {
      setLiveConnectionError(error?.message ?? "Failed to start voice session.");
    }
  }, [conversation, getLiveConnectionInfo, liveConnected, liveConnecting]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = textInput.trim();
    if (!text) return;
    sendMessage(text);
    setTextInput("");
  };

  const showChat = chatMessages.length > 0;
  const groupedSessions = groupSessionsByDate(sessions);
  const runningAgent = agents.find(a => a.status === "running");

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-[calc(100vh-65px)] overflow-hidden bg-black">

      {/* ── LEFT SIDEBAR ──────────────────────────────────────────────────── */}
      <aside
        className={`flex flex-col shrink-0 border-r border-zinc-800/60 bg-zinc-950 transition-all duration-300 overflow-hidden ${
          sidebarOpen ? "w-[260px]" : "w-0"
        }`}
      >
        {/* Sidebar header */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-zinc-800/60">
          <span className="text-[10px] tracking-[0.3em] uppercase text-zinc-500">Conversations</span>
          <button
            onClick={startNewChat}
            title="New chat"
            className="w-7 h-7 rounded-lg flex items-center justify-center text-zinc-500 hover:text-cyan-400 hover:bg-zinc-800 transition-all"
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14"/>
            </svg>
          </button>
        </div>

        {/* Session list */}
        <div className="flex-1 overflow-y-auto px-2 py-2 scrollbar-thin">
          {!sessionsLoaded ? (
            <div className="space-y-1.5 px-2 py-2">
              {[1,2,3].map(i => (
                <div key={i} className="h-9 bg-zinc-800/40 rounded-lg animate-pulse" style={{ opacity: 1 - i * 0.2 }} />
              ))}
            </div>
          ) : sessions.length === 0 ? (
            <div className="px-3 py-6 text-center">
              <p className="text-[11px] text-zinc-700">No conversations yet</p>
              <p className="text-[10px] text-zinc-800 mt-1">Start talking to Neo</p>
            </div>
          ) : (
            groupedSessions.map(group => (
              <div key={group.label} className="mb-3">
                <p className="px-3 py-1 text-[9px] tracking-[0.25em] uppercase text-zinc-700">{group.label}</p>
                {group.items.map(session => (
                  <button
                    key={session.sessionId}
                    onClick={() => loadSession(session.sessionId)}
                    className={`group w-full text-left px-3 py-2.5 rounded-lg mb-0.5 transition-all duration-150 flex items-start gap-2 ${
                      activeSessionId === session.sessionId
                        ? "bg-zinc-800 text-zinc-100"
                        : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
                    }`}
                  >
                    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 mt-0.5 shrink-0 text-zinc-600" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                    </svg>
                    <span className="flex-1 min-w-0 text-[12px] leading-snug truncate">{session.title}</span>
                    <button
                      onClick={(e) => deleteSession(session.sessionId, e)}
                      disabled={sidebarDeleting === session.sessionId}
                      className="opacity-0 group-hover:opacity-100 text-zinc-700 hover:text-red-400 transition-all shrink-0 mt-0.5"
                      title="Delete"
                    >
                      <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M18 6L6 18M6 6l12 12"/>
                      </svg>
                    </button>
                  </button>
                ))}
              </div>
            ))
          )}
        </div>

        {/* Sidebar footer links */}
        <div className="border-t border-zinc-800/60 px-3 py-3 space-y-0.5">
          <Link href="/dashboard" className="flex items-center gap-2.5 px-2 py-2 rounded-lg text-zinc-600 hover:text-zinc-300 hover:bg-zinc-900 transition-all text-[11px]">
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
              <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
            </svg>
            Org Dashboard
          </Link>
          <Link href="/settings" className="flex items-center gap-2.5 px-2 py-2 rounded-lg text-zinc-600 hover:text-zinc-300 hover:bg-zinc-900 transition-all text-[11px]">
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
            Settings
          </Link>
        </div>
      </aside>

      {/* ── MAIN CHAT AREA ────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 relative">

        {/* Sidebar toggle + agent status strip */}
        <div className="flex items-center gap-3 px-4 py-2.5 border-b border-zinc-800/40 bg-black/50 backdrop-blur-sm">
          <button
            onClick={() => setSidebarOpen(v => !v)}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-zinc-600 hover:text-zinc-400 hover:bg-zinc-800/50 transition-all"
            title={sidebarOpen ? "Close sidebar" : "Open sidebar"}
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
              {sidebarOpen
                ? <><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></>
                : <><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></>
              }
            </svg>
          </button>

          <div className="flex items-center gap-1.5 flex-1 overflow-x-auto scrollbar-none">
            {agents.map(a => (
              <div key={a.key} className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] tracking-wider uppercase shrink-0 transition-all duration-300 ${
                a.status === "running" ? "bg-cyan-950/50 text-cyan-400 border border-cyan-500/30" : "text-zinc-700"
              }`}>
                <div className={`w-1 h-1 rounded-full shrink-0 ${
                  a.status === "running" ? "bg-cyan-400 animate-pulse" :
                  a.status === "error"   ? "bg-red-500" :
                  a.lastRun             ? "bg-emerald-400/60" : "bg-zinc-800"
                }`} />
                {a.name.replace("Neo ", "")}
              </div>
            ))}
          </div>

          {/* New chat button in header (visible when sidebar is closed) */}
          {!sidebarOpen && (
            <button
              onClick={startNewChat}
              className="text-[10px] tracking-widest uppercase text-zinc-600 hover:text-cyan-400 transition-colors px-2 py-1 rounded-lg hover:bg-zinc-900 shrink-0"
            >
              + New
            </button>
          )}
        </div>

        {/* Background grid */}
        <div className="pointer-events-none absolute inset-0 opacity-[0.025] z-0"
          style={{ backgroundImage: "linear-gradient(rgba(6,182,212,1) 1px, transparent 1px), linear-gradient(90deg, rgba(6,182,212,1) 1px, transparent 1px)", backgroundSize: "60px 60px" }} />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_50%_at_50%_40%,transparent_30%,black_100%)] z-0" />

        {/* ── Empty state ──────────────────────────────────────────────────── */}
        {!showChat && (
          <div className="flex-1 flex flex-col items-center justify-center px-6 pb-28 z-10">
            {/* Voice orb */}
            <div className="relative flex items-center justify-center mb-10">
              {!listening && (
                <>
                  <div className="absolute w-44 h-44 rounded-full border border-cyan-400/15 ring-1-anim" />
                  <div className="absolute w-44 h-44 rounded-full border border-cyan-400/10 ring-2-anim" />
                  <div className="absolute w-44 h-44 rounded-full border border-cyan-400/6  ring-3-anim" />
                </>
              )}
              <button
                type="button"
                onClick={handleVoiceInput}
                disabled={liveConnecting}
                className={`relative z-10 w-44 h-44 rounded-full flex flex-col items-center justify-center gap-2 transition-all duration-300 border scanlines
                  ${liveConnecting || listening
                    ? "orb-listen bg-cyan-950/30 border-cyan-400/60 cursor-not-allowed scale-95"
                    : "orb-breathe bg-gradient-to-br from-zinc-900 via-black to-zinc-900 border-cyan-500/15 hover:border-cyan-400/35 hover:scale-105 active:scale-95"
                  }`}
              >
                <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_50%_40%,rgba(6,182,212,0.07),transparent_70%)]" />
                {(liveConnecting || listening) ? (
                  <div className="flex items-center gap-[3px] h-6">
                    {[0.6,1,0.75,1,0.5,0.85,0.65].map((h, i) => (
                      <div key={i} className="w-[3px] rounded-full bg-cyan-400 origin-bottom"
                        style={{ height:"100%", transform:`scaleY(${h})`, animation:`bar-wave ${0.5+i*0.07}s ease-in-out ${i*0.08}s infinite` }} />
                    ))}
                  </div>
                ) : (
                  <>
                    <span className="text-[9px] tracking-[0.35em] uppercase text-cyan-400/40 z-10">Talk to</span>
                    <span className="font-display text-4xl italic text-white z-10 leading-none">Neo</span>
                  </>
                )}
              </button>
              {liveConnectionError && (
                <p className="absolute -bottom-8 text-[11px] text-red-400/80 max-w-xs text-center">{liveConnectionError}</p>
              )}
            </div>

            {/* Suggestions */}
            <div className="grid grid-cols-2 gap-2 max-w-sm w-full">
              {[
                { label: "Morning brief", icon: "☀️", prompt: "Give me my morning brief" },
                { label: "PR triage",     icon: "⬡",  prompt: "What PRs need review?" },
                { label: "Schedule sync", icon: "📅", prompt: "Schedule a sync with my team" },
                { label: "Sprint status", icon: "⚡", prompt: "How is the sprint going?" },
              ].map(({ label, icon, prompt }) => (
                <button
                  key={label}
                  onClick={() => sendMessage(prompt)}
                  disabled={sending}
                  className="flex items-center gap-2.5 px-4 py-3 rounded-xl bg-zinc-900/60 border border-zinc-800/60 text-left hover:bg-zinc-900 hover:border-zinc-700 transition-all group disabled:opacity-40"
                >
                  <span className="text-base">{icon}</span>
                  <span className="text-[12px] text-zinc-400 group-hover:text-zinc-200 transition-colors">{label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Chat messages ─────────────────────────────────────────────────── */}
        {showChat && (
          <div className="flex-1 overflow-y-auto z-10 py-6 px-4">
            <div className="max-w-2xl mx-auto space-y-4">
              {chatMessages.map((msg, i) => (
                <div key={i} className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"} msg-appear`}>

                  {/* Assistant avatar */}
                  {msg.role === "assistant" && (
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-cyan-950 to-zinc-900 border border-cyan-500/20 flex items-center justify-center shrink-0 mt-1">
                      <span className="text-[9px] font-bold text-cyan-400">N</span>
                    </div>
                  )}

                  <div className={`flex flex-col gap-1 max-w-[80%] ${msg.role === "user" ? "items-end" : "items-start"}`}>
                    {/* Agent badge */}
                    {msg.agent && msg.role === "assistant" && (
                      <span className="text-[9px] tracking-[0.15em] uppercase text-cyan-400/50 px-2">
                        {AGENT_LABELS[msg.agent] ?? msg.agent}
                      </span>
                    )}

                    {/* Bubble */}
                    <div className={`px-4 py-3 rounded-2xl text-[13px] leading-relaxed whitespace-pre-wrap ${
                      msg.role === "user"
                        ? "bg-zinc-800 border border-zinc-700/50 text-zinc-100 rounded-tr-sm"
                        : "bg-zinc-900/80 border border-zinc-800 text-zinc-200 rounded-tl-sm"
                    }`}>
                      {msg.content}
                      {msg.isStreaming && <span className="typing-cursor ml-0.5">|</span>}
                    </div>

                    {/* Timestamp */}
                    {!msg.isStreaming && msg.timestamp && (
                      <span className="text-[10px] text-zinc-700 px-1">{msg.timestamp}</span>
                    )}
                  </div>

                  {/* User avatar */}
                  {msg.role === "user" && (
                    <div className="w-7 h-7 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center shrink-0 mt-1">
                      <span className="text-[9px] font-bold text-zinc-400">U</span>
                    </div>
                  )}
                </div>
              ))}

              {/* Thinking indicator */}
              {sending && (
                <div className="flex gap-3 justify-start msg-appear">
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-cyan-950 to-zinc-900 border border-cyan-500/20 flex items-center justify-center shrink-0 mt-1">
                    <span className="text-[9px] font-bold text-cyan-400">N</span>
                  </div>
                  <div className="px-4 py-3 bg-zinc-900/80 border border-zinc-800 rounded-2xl rounded-tl-sm flex items-center gap-2.5">
                    <div className="flex gap-[3px] items-end h-3.5">
                      <div className="w-[2px] bg-cyan-400 rounded-full animate-pulse" style={{ height:"40%" }} />
                      <div className="w-[2px] bg-cyan-400 rounded-full animate-pulse" style={{ height:"70%", animationDelay:"0.1s" }} />
                      <div className="w-[2px] bg-cyan-400 rounded-full animate-pulse" style={{ height:"100%", animationDelay:"0.2s" }} />
                      <div className="w-[2px] bg-cyan-400 rounded-full animate-pulse" style={{ height:"55%", animationDelay:"0.3s" }} />
                    </div>
                    <div className="flex flex-col">
                      {thinkingAgent && (
                        <span className="text-[9px] tracking-[0.12em] uppercase text-cyan-400/50">
                          {AGENT_LABELS[thinkingAgent] ?? "Neo"}
                        </span>
                      )}
                      <span className="text-[11px] text-zinc-500 thinking-fade">{thinkingPhrase}</span>
                    </div>
                  </div>
                </div>
              )}

              <div ref={chatEndRef} />
            </div>
          </div>
        )}

        {/* ── Input bar ─────────────────────────────────────────────────────── */}
        <div className="relative z-10 border-t border-zinc-800/50 bg-black/80 backdrop-blur-xl px-4 py-3">
          <div className="max-w-2xl mx-auto">
            <form onSubmit={handleSubmit} className="flex items-end gap-2">
              {/* Input + send */}
              <div className="flex-1 flex items-end gap-2 bg-zinc-900 border border-zinc-800 rounded-2xl px-3 py-2 focus-within:border-zinc-700 transition-colors">
                <textarea
                  value={textInput}
                  onChange={e => { setTextInput(e.target.value); e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px"; }}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); const t = textInput.trim(); if (t) { sendMessage(t); setTextInput(""); } } }}
                  placeholder={
                    liveConnected ? "Speak or type a follow-up…" :
                    liveConnecting ? "Connecting to voice…" :
                    sending ? "Neo is thinking…" :
                    "Ask Neo anything…"
                  }
                  disabled={liveConnecting || sending}
                  rows={1}
                  className="flex-1 bg-transparent text-[13px] text-zinc-200 placeholder-zinc-600 outline-none resize-none overflow-y-hidden leading-relaxed"
                  style={{ minHeight: "24px", maxHeight: "120px" }}
                />
                <button
                  type="submit"
                  disabled={!textInput.trim() || sending}
                  className="w-8 h-8 rounded-xl bg-cyan-500/15 border border-cyan-500/20 flex items-center justify-center text-cyan-400 hover:bg-cyan-500/25 transition-all disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
                >
                  <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
                  </svg>
                </button>
              </div>
            </form>

            {/* Voice status */}
            {(liveConnected || liveConnecting) && (
              <div className="flex items-center justify-center gap-2 mt-2">
                <div className={`w-1.5 h-1.5 rounded-full ${liveConnected ? "bg-cyan-400 animate-pulse" : "bg-amber-400 animate-pulse"}`} />
                <span className="text-[10px] text-zinc-600">
                  {liveConnected ? "Live voice active — speak to Neo" : "Connecting…"}
                </span>
                {liveConnected && (
                  <button onClick={handleVoiceInput} className="text-[10px] text-zinc-700 hover:text-red-400 transition-colors">
                    End call
                  </button>
                )}
              </div>
            )}
            {liveConnectionError && (
              <p className="text-center mt-1.5 text-[11px] text-red-400/80">{liveConnectionError}</p>
            )}
          </div>
        </div>
      </div>

      {!liveConnected && !liveConnecting && <VoicePlayer audioUrl={audioUrl} />}
    </div>
  );
}
