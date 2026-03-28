"use client";

import { useEffect, useRef, useState } from "react";

interface VoicePlayerProps {
  audioUrl: string | null;
}

export default function VoicePlayer({ audioUrl }: VoicePlayerProps) {
  const audioRef              = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);

  useEffect(() => {
    if (!audioUrl) { setPlaying(false); return; }
    const audio = new Audio();
    audio.src = audioUrl;
    audioRef.current = audio;
    audio.addEventListener("ended", () => setPlaying(false));
    audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    return () => { audio.pause(); audio.src = ""; };
  }, [audioUrl]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) { audio.pause(); setPlaying(false); }
    else         { audio.play().then(() => setPlaying(true)).catch(() => {}); }
  };

  if (!audioUrl) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 slide-up px-4 pb-5">
      <div className="mx-auto max-w-md">
        <div className="relative flex items-center gap-4 px-5 py-4 rounded-2xl border border-zinc-700/40 bg-zinc-900/95 backdrop-blur-2xl shadow-[0_-4px_50px_rgba(0,0,0,0.7)]">

          {/* Animated waveform bars */}
          <div className="flex items-center gap-[2px] h-5 shrink-0">
            {[0.4,0.85,0.55,1,0.7,0.5,0.9,0.45,0.75,0.95,0.6,0.8].map((h, i) => (
              <div
                key={i}
                className={`w-[2px] rounded-full origin-center ${playing ? "bg-cyan-400" : "bg-zinc-700"}`}
                style={{
                  height: "100%",
                  transform: `scaleY(${playing ? h : 0.2})`,
                  animation: playing ? `bar-wave ${0.45 + i * 0.04}s ease-in-out infinite alternate` : "none",
                  animationDelay: `${i * 0.06}s`,
                  transition: "transform 0.3s ease, background-color 0.2s",
                }}
              />
            ))}
          </div>

          {/* Label */}
          <div className="flex-1 min-w-0">
            <p className="text-[12px] text-zinc-200 tracking-wide">Neo Brief</p>
            <p className="text-[10px] text-zinc-600 mt-0.5 tracking-wide">
              {playing ? "Playing…" : "Paused"}
            </p>
          </div>

          {/* Read instead */}
          <button
            onClick={() => setShowTranscript(v => !v)}
            className="text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors tracking-widest uppercase"
          >
            {showTranscript ? "Hide" : "Read"}
          </button>

          {/* Play/Pause */}
          <button
            onClick={togglePlay}
            className="w-9 h-9 rounded-full border border-cyan-400/20 bg-cyan-400/8 hover:bg-cyan-400/15 hover:border-cyan-400/40 flex items-center justify-center transition-all duration-150 shrink-0"
          >
            {playing
              ? <span className="text-cyan-400 text-[10px] tracking-[-1px]">▐▐</span>
              : <span className="text-cyan-400 text-[10px] ml-px">▶</span>
            }
          </button>
        </div>

        {/* Transcript panel */}
        {showTranscript && (
          <div className="mt-1 px-5 py-4 rounded-xl border border-zinc-800 bg-zinc-950/95 backdrop-blur-xl text-[12px] text-zinc-400 leading-relaxed max-h-40 overflow-y-auto">
            Transcript not available — brief was generated as audio only.
          </div>
        )}
      </div>
    </div>
  );
}
