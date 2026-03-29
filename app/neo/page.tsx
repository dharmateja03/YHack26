"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { ConversationProvider, useConversation } from "@elevenlabs/react";
import VoicePlayer from "@/components/VoicePlayer";

// ── Types ────────────────────────────────────────────────────────────────────

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  agent?: string;
  timestamp: string;
}

interface LiveConnectionInfo {
  signedUrl: string | null;
  agentId: string | null;
  warning?: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_USER_ID = "";

const AGENT_LABELS: Record<string, string> = {
  "neo-chat": "Neo", "neo-brief": "Neo Brief", "neo-pr": "Neo PR",
  "neo-sched": "Neo Sched", "neo-root": "Neo Root", "neo-sprint": "Neo Sprint",
  "neo-hermes": "Neo",
};

const THINKING_PHRASES = [
  "Pulling context…", "Checking your data…", "Scanning PRs…",
  "Thinking…", "Connecting the dots…", "Analyzing…",
];

const QUICK_PROMPTS = [
  { label: "Morning brief", prompt: "Give me my morning briefing", icon: "☀️" },
  { label: "PR triage", prompt: "What are the recent PRs on my team?", icon: "🔀" },
  { label: "Sprint status", prompt: "How's the current sprint looking?", icon: "📊" },
  { label: "Team check-in", prompt: "Tell me about my team", icon: "👥" },
];

function generateSessionId() {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeAsrTranscript(text: string): string {
  let t = text.trim().replace(/^neo[,\s]+/i, "").trim();
  t = t
    .replace(/\bi'm\b/gi, "I am").replace(/\bdon't\b/gi, "do not")
    .replace(/\bcan't\b/gi, "cannot").replace(/\bwon't\b/gi, "will not")
    .replace(/\bwanna\b/gi, "want to").replace(/\bgonna\b/gi, "going to");
  return t.replace(/\s+/g, " ").trim();
}

// ── Root export ──────────────────────────────────────────────────────────────

export default function NeoPage() {
  return (
    <ConversationProvider>
      <NeoChat />
    </ConversationProvider>
  );
}

// ── Main Chat UI ─────────────────────────────────────────────────────────────

function NeoChat() {
  const [audioUrl, setAudioUrl]             = useState<string | null>(null);
  const [chatMessages, setChatMessages]     = useState<ChatMessage[]>([]);
  const [sending, setSending]               = useState(false);
  const [inputText, setInputText]           = useState("");
  const [sessionId]                         = useState(() => generateSessionId());
  const [currentUserId, setCurrentUserId]   = useState(DEFAULT_USER_ID);
  const [thinkingPhrase, setThinkingPhrase] = useState("Thinking…");
  const [pendingVoiceText, setPendingVoiceText] = useState("");

  const chatEndRef             = useRef<HTMLDivElement>(null);
  const pendingStopDispatchRef = useRef<string | null>(null);
  const inputRef               = useRef<HTMLInputElement>(null);

  // ElevenLabs
  const conversation = useConversation({
    volume: 1,
    onDisconnect: () => setPendingVoiceText(""),
    onError:      () => {},
    onMessage:    ({ role, message }) => { if (role === "user") setPendingVoiceText(message); },
  });

  const micOn       = conversation.status === "connected";
  const micStarting = conversation.status === "connecting";
  const speakerActive = Boolean(audioUrl);

  // ── Effects ────────────────────────────────────────────────────────────────

  // Kill mic when speaker is active (Neo talks → mic must be off)
  useEffect(() => {
    if (speakerActive && micOn) { try { conversation.endSession(); } catch {} }
  }, [speakerActive, micOn, conversation]);

  // Clear audio on mic connect
  useEffect(() => {
    if (!micOn && !micStarting) return;
    setAudioUrl(prev => { if (prev) URL.revokeObjectURL(prev); return null; });
  }, [micOn, micStarting]);

  // Send queued voice text after mic is turned off
  useEffect(() => {
    if (micOn || micStarting || sending) return;
    const queued = pendingStopDispatchRef.current;
    if (!queued) return;
    pendingStopDispatchRef.current = null;
    void sendMessage(queued, true);
  }, [micOn, micStarting, sending]);

  // Auto-scroll to bottom
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatMessages, sending]);

  // Resolve user identity
  useEffect(() => {
    fetch("/api/users/me").then(r => r.ok ? r.json() : null).then(data => {
      if (typeof data?.userId === "string" && data.userId.trim()) setCurrentUserId(data.userId.trim());
    }).catch(() => {});
  }, []);

  // Thinking phrase cycle
  useEffect(() => {
    if (!sending) return;
    let i = 0;
    const iv = setInterval(() => { i = (i + 1) % THINKING_PHRASES.length; setThinkingPhrase(THINKING_PHRASES[i]); }, 1800);
    return () => clearInterval(iv);
  }, [sending]);

  // ── Send message ───────────────────────────────────────────────────────────

  const sendMessage = async (text: string, forceAudio = false) => {
    if (!text.trim() || sending) return;
    setSending(true);

    const userMsg: ChatMessage = {
      role: "user", content: text,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };
    setChatMessages(prev => [...prev, userMsg]);

    try {
      const res = await fetch("/api/agents/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: forceAudio ? "audio/mpeg, application/json" : "application/json" },
        body: JSON.stringify({ message: text, sessionId, userId: currentUserId }),
      });

      if (!res.ok) throw new Error(`${res.status}`);
      const ct = res.headers.get("content-type") ?? "";
      let reply = "";
      let resolvedAgent = "neo-chat";

      if (forceAudio && ct.includes("audio")) {
        try { reply = decodeURIComponent(res.headers.get("X-Neo-Reply") ?? ""); } catch { reply = ""; }
        resolvedAgent = res.headers.get("X-Neo-Agent") ?? "neo-chat";
        void res.blob().then(blob => {
          setAudioUrl(prev => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(blob); });
        }).catch(() => {});
      } else {
        const data = await res.json();
        reply = data?.reply ?? "";
        resolvedAgent = data?.agent ?? "neo-chat";
      }

      if (!reply.trim()) reply = "I couldn't generate a response right now. Try again.";

      setChatMessages(prev => [...prev, {
        role: "assistant", content: reply, agent: resolvedAgent,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      }]);
    } catch {
      setChatMessages(prev => [...prev, {
        role: "assistant", content: "Something went wrong. Try again.",
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      }]);
    } finally {
      setSending(false);
    }
  };

  // ── Mic toggle (on/off, stays in conversation) ─────────────────────────────

  const getLiveConnectionInfo = useCallback(async (): Promise<LiveConnectionInfo | null> => {
    try {
      const res = await fetch("/api/elevenlabs/signed-url");
      if (!res.ok) return null;
      const data = await res.json().catch(() => ({}));
      return {
        signedUrl: typeof data?.signedUrl === "string" ? data.signedUrl : null,
        agentId:   typeof data?.agentId   === "string" ? data.agentId   : null,
      };
    } catch { return null; }
  }, []);

  const toggleMic = useCallback(async () => {
    if (micStarting || sending || speakerActive) return;

    if (micOn) {
      // Turn mic OFF → send whatever was captured
      const cleaned = normalizeAsrTranscript(pendingVoiceText);
      if (cleaned) pendingStopDispatchRef.current = cleaned;
      try { conversation.endSession(); } catch {}
      setPendingVoiceText("");
    } else {
      // Turn mic ON
      setPendingVoiceText("");
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true });
        const conn = await getLiveConnectionInfo();
        if (conn?.signedUrl) { conversation.startSession({ signedUrl: conn.signedUrl }); return; }
        if (conn?.agentId)   { conversation.startSession({ agentId: conn.agentId, connectionType: "webrtc" }); return; }
        const agentId = process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID;
        if (!agentId) throw new Error("Voice not configured.");
        conversation.startSession({ agentId, connectionType: "webrtc" });
      } catch {}
    }
  }, [micOn, micStarting, sending, speakerActive, conversation, pendingVoiceText, getLiveConnectionInfo]);

  // ── Quick prompt (voice) ───────────────────────────────────────────────────

  const handleQuickPrompt = useCallback((prompt: string) => {
    if (sending || speakerActive) return;
    if (micOn) { try { conversation.endSession(); } catch {} }
    void sendMessage(prompt, true);
  }, [sending, speakerActive, micOn, conversation]);

  // ── Text submit ────────────────────────────────────────────────────────────

  const handleTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || sending) return;
    const text = inputText.trim();
    setInputText("");
    void sendMessage(text, false);
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  const isEmpty = chatMessages.length === 0 && !sending;

  return (
    <div className="flex flex-col h-[calc(100vh-65px)] bg-[#07090d] text-white overflow-hidden">

      {/* ── Main chat area ─────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-4 py-6">

          {isEmpty ? (
            /* ── Empty state with quick prompts ────────────────────── */
            <div className="flex flex-col items-center justify-center h-[calc(100vh-200px)]">
              {/* Neo avatar */}
              <div className="relative mb-8">
                <div className="absolute inset-0 w-24 h-24 rounded-full border border-cyan-400/10 animate-ping" style={{ animationDuration: "3s" }} />
                <div className="w-24 h-24 rounded-full bg-gradient-to-br from-zinc-800 via-zinc-900 to-black border border-zinc-700/50 flex items-center justify-center shadow-2xl shadow-cyan-500/5">
                  <span className="text-4xl italic text-white" style={{ fontFamily: "'Instrument Serif', serif" }}>N</span>
                </div>
              </div>

              <h2 className="text-xl font-medium text-white mb-1 tracking-tight">What can I help with?</h2>
              <p className="text-[13px] text-zinc-500 mb-8">Ask anything or pick a suggestion</p>

              <div className="grid grid-cols-2 gap-3 w-full max-w-md">
                {QUICK_PROMPTS.map(qp => (
                  <button
                    key={qp.label}
                    onClick={() => handleQuickPrompt(qp.prompt)}
                    disabled={sending || speakerActive}
                    className="group flex items-center gap-3 px-4 py-3.5 rounded-xl border border-zinc-800/80 bg-zinc-900/50 hover:bg-zinc-800/60 hover:border-zinc-700 text-left transition-all disabled:opacity-40"
                  >
                    <span className="text-lg shrink-0">{qp.icon}</span>
                    <span className="text-[13px] text-zinc-300 group-hover:text-white transition-colors">{qp.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            /* ── Message thread ────────────────────────────────────── */
            <div className="space-y-5 pb-4">
              {chatMessages.map((msg, i) => (
                <div key={i} className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  {msg.role === "assistant" && (
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-cyan-600/20 to-cyan-900/20 border border-cyan-500/20 flex items-center justify-center shrink-0 mt-0.5">
                      <span className="text-[11px] italic text-cyan-300" style={{ fontFamily: "'Instrument Serif', serif" }}>N</span>
                    </div>
                  )}
                  <div className={`max-w-[80%] ${msg.role === "user" ? "order-first" : ""}`}>
                    {msg.role === "assistant" && msg.agent && (
                      <span className="text-[10px] text-cyan-400/50 tracking-wide uppercase mb-1 block">
                        {AGENT_LABELS[msg.agent] ?? msg.agent}
                      </span>
                    )}
                    <div className={`rounded-2xl px-4 py-2.5 text-[14px] leading-relaxed ${
                      msg.role === "user"
                        ? "bg-cyan-600/15 border border-cyan-500/15 text-zinc-100"
                        : "bg-zinc-800/50 border border-zinc-700/30 text-zinc-200"
                    }`}>
                      {msg.content}
                    </div>
                    <span className="text-[10px] text-zinc-600 mt-1 block px-1">{msg.timestamp}</span>
                  </div>
                </div>
              ))}

              {/* Thinking indicator */}
              {sending && (
                <div className="flex gap-3">
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-cyan-600/20 to-cyan-900/20 border border-cyan-500/20 flex items-center justify-center shrink-0 mt-0.5">
                    <span className="text-[11px] italic text-cyan-300" style={{ fontFamily: "'Instrument Serif', serif" }}>N</span>
                  </div>
                  <div className="bg-zinc-800/50 border border-zinc-700/30 rounded-2xl px-4 py-2.5">
                    <span className="text-[14px] text-zinc-400 animate-pulse">{thinkingPhrase}</span>
                  </div>
                </div>
              )}

              <div ref={chatEndRef} />
            </div>
          )}
        </div>
      </div>

      {/* ── Live transcript preview (when mic is on) ──────────────── */}
      {micOn && pendingVoiceText.trim() && (
        <div className="border-t border-zinc-800/40 bg-zinc-900/50 px-4 py-2">
          <div className="mx-auto max-w-2xl flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-red-400 animate-pulse shrink-0" />
            <p className="text-[13px] text-zinc-400 italic truncate">&ldquo;{pendingVoiceText.trim()}&rdquo;</p>
          </div>
        </div>
      )}

      {/* ── Bottom input bar ──────────────────────────────────────── */}
      <div className="border-t border-zinc-800/50 bg-zinc-950/80 backdrop-blur-sm px-4 py-3">
        <div className="mx-auto max-w-2xl">
          <form onSubmit={handleTextSubmit} className="flex items-center gap-3">

            {/* Mic toggle button */}
            <button
              type="button"
              onClick={toggleMic}
              disabled={micStarting || sending || speakerActive}
              title={micOn ? "Turn mic off (sends message)" : "Turn mic on"}
              className={`relative shrink-0 w-11 h-11 rounded-full flex items-center justify-center transition-all duration-200 disabled:opacity-40 ${
                micOn
                  ? "bg-red-500/20 border-2 border-red-400 hover:bg-red-500/30 shadow-lg shadow-red-500/10"
                  : "bg-zinc-800 border border-zinc-700 hover:bg-zinc-700 hover:border-zinc-600"
              }`}
            >
              {micStarting ? (
                <div className="w-4 h-4 border-2 border-zinc-500 border-t-transparent rounded-full animate-spin" />
              ) : micOn ? (
                /* Mic ON icon (with red slash to indicate "click to stop") */
                <svg viewBox="0 0 24 24" className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/>
                  <line x1="8" y1="23" x2="16" y2="23"/>
                </svg>
              ) : (
                /* Mic OFF icon */
                <svg viewBox="0 0 24 24" className="w-5 h-5 text-zinc-400" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/>
                  <line x1="8" y1="23" x2="16" y2="23"/>
                </svg>
              )}

              {/* Recording pulse ring */}
              {micOn && <span className="absolute inset-0 rounded-full border border-red-400/40 animate-ping" style={{ animationDuration: "1.5s" }} />}
            </button>

            {/* Text input */}
            <div className="flex-1 relative">
              <input
                ref={inputRef}
                type="text"
                value={inputText}
                onChange={e => setInputText(e.target.value)}
                placeholder={micOn ? "Listening… tap mic to send" : speakerActive ? "Neo is speaking…" : "Message Neo…"}
                disabled={micOn || sending || speakerActive}
                className="w-full rounded-xl bg-zinc-800/60 border border-zinc-700/50 px-4 py-2.5 text-[14px] text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-cyan-500/40 focus:ring-1 focus:ring-cyan-500/20 disabled:opacity-50 transition-all"
              />
            </div>

            {/* Send button */}
            <button
              type="submit"
              disabled={!inputText.trim() || sending || micOn || speakerActive}
              className="shrink-0 w-11 h-11 rounded-full bg-cyan-600 hover:bg-cyan-500 disabled:bg-zinc-800 disabled:border-zinc-700 border border-cyan-500 disabled:border-zinc-700 flex items-center justify-center transition-all disabled:opacity-40"
            >
              <svg viewBox="0 0 24 24" className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
              </svg>
            </button>
          </form>

          {/* Status line */}
          <div className="flex items-center justify-between mt-2 px-1">
            <div className="flex items-center gap-2">
              {micOn && (
                <>
                  <div className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
                  <span className="text-[11px] text-red-400/80">Listening — tap mic to send</span>
                </>
              )}
              {speakerActive && (
                <>
                  <div className="flex items-center gap-[1.5px] h-3">
                    {[0.4, 0.8, 0.5, 1, 0.6].map((h, i) => (
                      <div key={i} className="w-[2px] rounded-full bg-emerald-400 origin-bottom" style={{
                        height: "100%", transform: `scaleY(${h})`,
                        animationName: "bar-wave", animationDuration: `${0.5 + i * 0.07}s`,
                        animationTimingFunction: "ease-in-out", animationDelay: `${i * 0.08}s`,
                        animationIterationCount: "infinite",
                      }} />
                    ))}
                  </div>
                  <span className="text-[11px] text-emerald-400/80">Neo is speaking</span>
                </>
              )}
              {sending && !speakerActive && (
                <>
                  <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                  <span className="text-[11px] text-amber-400/80">{thinkingPhrase}</span>
                </>
              )}
            </div>
            {micOn && (
              <span className="text-[10px] text-zinc-600">mic is on</span>
            )}
          </div>
        </div>
      </div>

      {/* Audio player (hidden, plays Neo response) */}
      {!micOn && !micStarting && (
        <VoicePlayer
          audioUrl={audioUrl}
          onEnded={() => setAudioUrl(prev => { if (prev) URL.revokeObjectURL(prev); return null; })}
        />
      )}
    </div>
  );
}
