"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";

/* ─── feature data ─── */

const FEATURES = [
  {
    num: "01",
    label: "Neo Mail",
    title: "Email that writes itself.",
    body: "Confirmations, reschedule notes, and follow-ups — sent from meeting context, not from scratch.",
  },
  {
    num: "02",
    label: "Neo Brief",
    title: "Briefs before you ask.",
    body: "Pre-reads, post-meeting summaries, and action items — assembled the moment a meeting ends.",
  },
  {
    num: "03",
    label: "Neo PR",
    title: "Code meets calendar.",
    body: "Meeting outcomes mapped to pull requests. Review priorities surfaced instantly.",
  },
  {
    num: "04",
    label: "Neo Productivity",
    title: "Momentum, measured.",
    body: "Execution velocity across meetings, email, and code delivery — one clear signal.",
  },
];

/* ─── scroll-triggered reveal ─── */

function useReveal(threshold = 0.15) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setVisible(true);
          obs.disconnect();
        }
      },
      { threshold },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);

  return { ref, visible };
}

function Reveal({
  children,
  delay = 0,
  className = "",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const { ref, visible } = useReveal();
  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(40px)",
        transition: `opacity 0.9s cubic-bezier(0.16,1,0.3,1) ${delay}ms, transform 0.9s cubic-bezier(0.16,1,0.3,1) ${delay}ms`,
      }}
    >
      {children}
    </div>
  );
}

/* ─── page ─── */

export default function LandingPage() {
  return (
    <div className="min-h-screen text-[#e8e8e8] selection:bg-cyan-400/20">
      {/* ── HERO ── */}
      <section className="relative flex min-h-[90vh] flex-col items-center justify-center px-6">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_50%_40%_at_50%_0%,rgba(34,211,238,0.05),transparent_70%)]" />

        <div className="relative z-10 text-center">
          <p className="hero-reveal text-[10px] uppercase tracking-[0.35em] text-cyan-400/60">
            The Affordable AI Executive Assistant
          </p>

          <h1
            className="hero-reveal mt-6 text-[clamp(3.5rem,8vw,7rem)] leading-[1] tracking-tight text-white"
            style={{
              fontFamily: "var(--font-display)",
              animationDelay: "100ms",
            }}
          >
            Neos<span className="text-cyan-400">is</span>
          </h1>

          <p
            className="hero-reveal mx-auto mt-6 max-w-sm text-[13px] leading-[1.7] text-zinc-500"
            style={{ animationDelay: "220ms" }}
          >
            Start with context. Then execute everything —
            <br className="hidden sm:inline" />
            email, briefs, PRs, momentum — one at a time.
          </p>

          <div
            className="hero-reveal mt-10 flex items-center justify-center gap-4"
            style={{ animationDelay: "360ms" }}
          >
            <Link
              href="/neo"
              className="rounded-full bg-white px-7 py-2.5 text-[11px] font-medium uppercase tracking-[0.18em] text-[#09090b] transition-all duration-300 hover:bg-cyan-300 hover:shadow-[0_0_30px_rgba(34,211,238,0.2)]"
            >
              Launch Neo
            </Link>
            <Link
              href="/dashboard"
              className="rounded-full border border-white/[0.08] px-7 py-2.5 text-[11px] uppercase tracking-[0.18em] text-zinc-500 transition-all duration-300 hover:border-white/20 hover:text-white"
            >
              Dashboard
            </Link>
          </div>
        </div>

        <div className="absolute bottom-10 flex flex-col items-center">
          <div className="scroll-line h-10 w-px bg-gradient-to-b from-transparent via-zinc-700 to-transparent" />
        </div>
      </section>

      {/* ── NEO SCHED — constant context block ── */}
      <section className="px-6 pb-28">
        <div className="mx-auto max-w-[640px]">
          <Reveal>
            <div className="relative overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.02] p-8 md:p-10">
              <div className="pointer-events-none absolute -top-20 left-1/2 h-40 w-40 -translate-x-1/2 rounded-full bg-cyan-400/[0.06] blur-3xl" />

              <div className="relative">
                <div className="flex items-center gap-2.5">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-40" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-cyan-400" />
                  </span>
                  <span className="text-[10px] uppercase tracking-[0.3em] text-cyan-400/70">
                    Always On
                  </span>
                </div>

                <h2
                  className="mt-6 text-[2rem] tracking-tight text-white md:text-[2.5rem]"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  Neo Sched
                </h2>

                <p className="mt-3 max-w-md text-[13px] leading-[1.7] text-zinc-500">
                  The context layer. Resolves participants, time, and intent
                  before any downstream action. Every agent reads from here.
                </p>

                <div className="mt-8 grid grid-cols-3 gap-3">
                  {[
                    { label: "Time Saved", value: "31h", unit: "/wk" },
                    { label: "Flow", value: "Sequential", unit: "" },
                    { label: "Agents", value: "4", unit: " active" },
                  ].map((s) => (
                    <div
                      key={s.label}
                      className="rounded-xl border border-white/[0.04] bg-white/[0.015] px-4 py-3"
                    >
                      <p className="text-[9px] uppercase tracking-[0.25em] text-zinc-600">
                        {s.label}
                      </p>
                      <p
                        className="mt-1.5 text-lg text-white"
                        style={{ fontFamily: "var(--font-display)" }}
                      >
                        {s.value}
                        {s.unit && (
                          <span className="text-sm text-zinc-600">
                            {s.unit}
                          </span>
                        )}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── divider ── */}
      <div className="mx-auto h-px w-12 bg-white/[0.06]" />

      {/* ── FEATURES — staggered one-by-one ── */}
      <section className="px-6 py-28">
        <div className="mx-auto max-w-[640px] space-y-24">
          {FEATURES.map((f) => (
            <Reveal key={f.num}>
              <article>
                <div className="flex items-center gap-3">
                  <span className="text-[11px] tabular-nums text-zinc-700">
                    {f.num}
                  </span>
                  <span className="h-px flex-1 bg-white/[0.05]" />
                  <span className="text-[10px] uppercase tracking-[0.25em] text-zinc-600">
                    {f.label}
                  </span>
                </div>

                <h3
                  className="mt-5 text-[1.65rem] tracking-tight text-white md:text-[2rem]"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  {f.title}
                </h3>

                <p className="mt-3 text-[13px] leading-[1.7] text-zinc-500">
                  {f.body}
                </p>
              </article>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ── FINAL CTA ── */}
      <section className="px-6 pb-32 pt-8">
        <Reveal>
          <div className="mx-auto max-w-[640px] text-center">
            <h2
              className="text-4xl tracking-tight text-white md:text-5xl"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Start with Neo.
            </h2>
            <p className="mt-4 text-[13px] text-zinc-600">
              Context first. Everything else follows.
            </p>
            <div className="mt-8">
              <Link
                href="/neo"
                className="inline-block rounded-full bg-white px-8 py-3 text-[11px] font-medium uppercase tracking-[0.18em] text-[#09090b] transition-all duration-300 hover:bg-cyan-300 hover:shadow-[0_0_30px_rgba(34,211,238,0.2)]"
              >
                Launch Neo
              </Link>
            </div>
          </div>
        </Reveal>
      </section>
    </div>
  );
}
