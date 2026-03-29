"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import VoicePlayer from "@/components/VoicePlayer";

// ── Types ────────────────────────────────────────────────────────────────────

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  agent?: string;
  timestamp: string;
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

function getSpeechRecognition(): (new () => SpeechRecognition) | null {
  if (typeof window === "undefined") return null;
  return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;
}

// ── Root export ──────────────────────────────────────────────────────────────

export default function NeoPage() {
  return <NeoChat />;
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

  // Mic / speech recognition state
  const [micOn, setMicOn]                   = useState(false);
  const [liveTranscript, setLiveTranscript] = useState("");
  const [micSupported]                      = useState(() => getSpeechRecognition() !== null);
  const recognitionRef                      = useRef<SpeechRecognition | null>(null);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef   = useRef<HTMLInputElement>(null);

  const speakerActive = Boolean(audioUrl);

  // ── Effects ────────────────────────────────────────────────────────────────

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

  // Stop mic if Neo starts speaking
  useEffect(() => {
    if (speakerActive && micOn) stopMic(false);
  }, [speakerActive]);

  // Cleanup recognition on unmount
  useEffect(() => {
    return () => { recognitionRef.current?.abort(); };
  }, []);

  // ── Send message ───────────────────────────────────────────────────────────

  const sendMessage = useCallback(async (text: string, forceAudio = false) => {
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
        headers: {
          "Content-Type": "application/json",
          Accept: forceAudio ? "audio/mpeg, application/json" : "application/json",
        },
        body: JSON.stringify({ message: text, sessionId, userId: currentUserId }),
      });

      if (!res.ok) throw new Error(`${res.status}`);
      const ct = res.headers.get("content-type") ?? "";
      let reply = "";
      let resolvedAgent = "neo-chat";

      if (forceAudio && ct.includes("audio")) {
        try { reply = decodeURIComponent(res.headers.get("X-Neo-Reply") ?? ""); } catch { reply = ""; }
        resolvedAgent = res.headers.get("X-Neo-Agent") ?? "neo-chat";
        const blob = await res.blob();
        setAudioUrl(prev => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(blob); });
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
  }, [sending, sessionId, currentUserId]);

  // ── Mic: Browser Speech Recognition ────────────────────────────────────────

  const stopMic = useCallback((shouldSend: boolean) => {
    const rec = recognitionRef.current;
    if (rec) { rec.onresult = null; rec.onend = null; rec.onerror = null; rec.abort(); }
    recognitionRef.current = null;

    if (shouldSend) {
      setLiveTranscript(prev => {
        const cleaned = prev.trim();
        if (cleaned) {
          void sendMessage(cleaned, true);
        }
        return "";
      });
    } else {
      setLiveTranscript("");
    }
    setMicOn(false);
  }, [sendMessage]);

  const startMic = useCallback(() => {
    const SRClass = getSpeechRecognition();
    if (!SRClass) return;

    setLiveTranscript("");
    const recognition = new SRClass();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let full = "";
      for (let i = 0; i < event.results.length; i++) {
        full += event.results[i][0].transcript;
      }
      setLiveTranscript(full);
    };

    recognition.onerror = () => {
      setMicOn(false);
      recognitionRef.current = null;
    };

    recognition.onend = () => {
      // Browser may auto-stop after silence; restart if still supposed to be on
      if (recognitionRef.current === recognition) {
        try { recognition.start(); } catch { setMicOn(false); recognitionRef.current = null; }
      }
    };

    recognition.start();
    recognitionRef.current = recognition;
    setMicOn(true);
  }, []);

  const toggleMic = useCallback(() => {
    if (sending || speakerActive) return;
    if (micOn) {
      stopMic(true);
    } else {
      startMic();
    }
  }, [micOn, sending, speakerActive, startMic, stopMic]);

  // ── Quick prompt ───────────────────────────────────────────────────────────

  const handleQuickPrompt = useCallback((prompt: string) => {
    if (sending || speakerActive) return;
    if (micOn) stopMic(false);
    void sendMessage(prompt, true);
  }, [sending, speakerActive, micOn, stopMic, sendMessage]);

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
      {micOn && liveTranscript.trim() && (
        <div className="border-t border-zinc-800/40 bg-zinc-900/50 px-4 py-2">
          <div className="mx-auto max-w-2xl flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-red-400 animate-pulse shrink-0" />
            <p className="text-[13px] text-zinc-400 italic truncate">&ldquo;{liveTranscript.trim()}&rdquo;</p>
          </div>
        </div>
      )}

      {/* ── Bottom input bar ──────────────────────────────────────── */}
      <div className="border-t border-zinc-800/50 bg-zinc-950/80 backdrop-blur-sm px-4 py-3">
        <div className="mx-auto max-w-2xl">
          <form onSubmit={handleTextSubmit} className="flex items-center gap-3">

            {/* Mic toggle button */}
            {micSupported && (
              <button
                type="button"
                onClick={toggleMic}
                disabled={sending || speakerActive}
                title={micOn ? "Stop listening & send" : "Start listening"}
                className={`relative shrink-0 w-11 h-11 rounded-full flex items-center justify-center transition-all duration-200 disabled:opacity-40 ${
                  micOn
                    ? "bg-red-500/20 border-2 border-red-400 hover:bg-red-500/30 shadow-lg shadow-red-500/10"
                    : "bg-zinc-800 border border-zinc-700 hover:bg-zinc-700 hover:border-zinc-600"
                }`}
              >
                {micOn ? (
                  <svg viewBox="0 0 24 24" className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/>
                    <line x1="8" y1="23" x2="16" y2="23"/>
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" className="w-5 h-5 text-zinc-400" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/>
                    <line x1="8" y1="23" x2="16" y2="23"/>
                  </svg>
                )}

                {micOn && <span className="absolute inset-0 rounded-full border border-red-400/40 animate-ping" style={{ animationDuration: "1.5s" }} />}
              </button>
            )}

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
          <div className="flex items-center justify-between mt-2 px-1 min-h-[18px]">
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
          </div>
        </div>
      </div>

      {/* Audio player (hidden, plays Neo's TTS response) */}
      <VoicePlayer
        audioUrl={audioUrl}
        onEnded={() => setAudioUrl(prev => { if (prev) URL.revokeObjectURL(prev); return null; })}
      />
    </div>
  );
}
