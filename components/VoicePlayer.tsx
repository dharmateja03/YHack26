"use client";

import { useEffect, useRef, useState } from "react";

interface VoicePlayerProps {
  audioUrl: string | null;
}

export default function VoicePlayer({ audioUrl }: VoicePlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);

  useEffect(() => {
    if (!audioUrl) {
      setPlaying(false);
      return;
    }

    // Fetch with Accept: audio/mpeg and play via Web Audio API
    const audio = new Audio();
    audio.src = audioUrl;
    audioRef.current = audio;

    audio.addEventListener("ended", () => setPlaying(false));
    audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));

    return () => {
      audio.pause();
      audio.src = "";
    };
  }, [audioUrl]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
    } else {
      audio.play().then(() => setPlaying(true)).catch(() => {});
    }
  };

  if (!audioUrl) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-zinc-900 border-t border-zinc-700 px-6 py-3 flex items-center gap-4">
      <button
        onClick={togglePlay}
        className="w-8 h-8 rounded-full bg-white text-zinc-900 flex items-center justify-center text-sm font-bold shrink-0"
        aria-label={playing ? "Pause" : "Play"}
      >
        {playing ? "⏸" : "▶"}
      </button>
      <span className="text-sm text-zinc-300 flex-1 truncate">Neo brief playing…</span>
      <button
        onClick={() => setShowTranscript((v) => !v)}
        className="text-xs text-zinc-400 underline shrink-0"
      >
        {showTranscript ? "Hide" : "Read instead"}
      </button>
      {showTranscript && transcript && (
        <div className="absolute bottom-full left-0 right-0 bg-zinc-800 border-t border-zinc-700 px-6 py-4 text-sm text-zinc-200 max-h-48 overflow-y-auto">
          {transcript}
        </div>
      )}
    </div>
  );
}
