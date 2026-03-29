import Link from "next/link";

const FOLLOW_UP_FEATURES = [
  {
    id: "02",
    agent: "Neo Mail",
    title: "Email follow-ups",
    detail:
      "Sends confirmations, reschedule notes, and reminders directly from the meeting thread.",
  },
  {
    id: "03",
    agent: "Neo Brief",
    title: "Auto briefs",
    detail:
      "Creates crisp pre-reads and post-meeting summaries with action items and owners.",
  },
  {
    id: "04",
    agent: "Neo PR",
    title: "PR alignment",
    detail:
      "Maps meeting outcomes to pull requests and highlights what needs review next.",
  },
  {
    id: "05",
    agent: "Neo Productivity",
    title: "Productivity tracking",
    detail:
      "Tracks execution momentum across meetings, email loops, and code delivery.",
  },
];

export default function LandingPage() {
  return (
    <div className="relative min-h-[calc(100vh-65px)] overflow-hidden bg-[#07090d] text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_75%_60%_at_50%_0%,rgba(34,211,238,0.16),transparent_70%)]" />
      <div className="pointer-events-none absolute left-1/2 top-20 h-[380px] w-[380px] -translate-x-1/2 rounded-full bg-cyan-500/10 blur-3xl" />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.035]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(34,211,238,1) 1px, transparent 1px), linear-gradient(90deg, rgba(34,211,238,1) 1px, transparent 1px)",
          backgroundSize: "74px 74px",
        }}
      />

      <section className="relative z-10 mx-auto w-full max-w-5xl px-6 pb-16 pt-12 md:pt-16">
        <div className="space-y-4 text-center">
          <p className="text-[10px] uppercase tracking-[0.28em] text-cyan-300/80">Neo Workflow</p>
          <h1 className="font-display text-5xl italic leading-[0.94] text-white md:text-7xl">
            Start with context, then execute everything.
          </h1>
          <p className="mx-auto max-w-2xl text-[14px] leading-relaxed text-zinc-400 md:text-[15px]">
            `Neo Sched` stays as the constant context layer. Then your flow continues one step at a time:
            email, briefs, PR decisions, and productivity signal.
          </p>
        </div>

        <div className="mt-8 rounded-[28px] border border-cyan-400/30 bg-gradient-to-b from-cyan-500/10 to-zinc-900/80 p-6 md:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-[0.24em] text-cyan-300">Neo Sched</p>
              <h2 className="mt-1 text-2xl text-white md:text-3xl">Context-first scheduling engine</h2>
            </div>
            <span className="rounded-full border border-cyan-400/40 bg-cyan-500/10 px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-cyan-200">
              Always On
            </span>
          </div>
          <p className="mt-3 max-w-3xl text-[13px] leading-relaxed text-zinc-300 md:text-[14px]">
            Neo resolves participants, time constraints, and intent before any downstream action. This context is reused by all other agents.
          </p>

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-zinc-700/70 bg-zinc-900/60 px-4 py-3">
              <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Time Saved</p>
              <p className="mt-1 text-2xl font-semibold text-cyan-300">31h / week</p>
            </div>
            <div className="rounded-xl border border-zinc-700/70 bg-zinc-900/60 px-4 py-3">
              <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Flow Mode</p>
              <p className="mt-1 text-2xl font-semibold text-zinc-100">Sequential</p>
            </div>
            <div className="rounded-xl border border-zinc-700/70 bg-zinc-900/60 px-4 py-3">
              <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Output</p>
              <p className="mt-1 text-2xl font-semibold text-zinc-100">Email + Brief + PR</p>
            </div>
          </div>
        </div>

        <div className="relative mt-8 pl-6">
          <div className="pointer-events-none absolute bottom-2 left-2 top-2 w-px bg-gradient-to-b from-cyan-400/70 to-cyan-400/10" />
          <div className="space-y-4">
            {FOLLOW_UP_FEATURES.map((item, i) => (
              <article
                key={item.id}
                className="fade-up opacity-0 rounded-2xl border border-zinc-800/80 bg-zinc-900/65 p-4 md:p-5"
                style={{ animationDelay: `${i * 190}ms` }}
              >
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-cyan-400/40 bg-cyan-500/10 text-[10px] text-cyan-200">
                    {item.id}
                  </span>
                  <p className="text-[10px] uppercase tracking-[0.22em] text-cyan-300/80">{item.agent}</p>
                </div>
                <h3 className="mt-2 text-[20px] text-white md:text-[22px]">{item.title}</h3>
                <p className="mt-1 text-[13px] leading-relaxed text-zinc-400">{item.detail}</p>
              </article>
            ))}
          </div>
        </div>

        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link
            href="/neo"
            className="rounded-xl border border-cyan-400/40 bg-cyan-500/12 px-5 py-3 text-[12px] uppercase tracking-[0.2em] text-cyan-200 transition hover:bg-cyan-500/22"
          >
            Launch Neo
          </Link>
          <Link
            href="/dashboard"
            className="rounded-xl border border-zinc-700 px-5 py-3 text-[12px] uppercase tracking-[0.2em] text-zinc-300 transition hover:border-zinc-500 hover:text-white"
          >
            Open Dashboard
          </Link>
        </div>
      </section>
    </div>
  );
}
