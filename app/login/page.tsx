"use client";

export default function LoginPage() {
  return (
    <div className="relative flex items-center justify-center min-h-[calc(100vh-65px)] px-6 overflow-hidden">

      {/* Background grid */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.025]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(6,182,212,1) 1px, transparent 1px), linear-gradient(90deg, rgba(6,182,212,1) 1px, transparent 1px)",
          backgroundSize: "60px 60px",
        }}
      />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_40%,transparent_30%,black_100%)]" />

      <div className="relative z-10 w-full max-w-sm flex flex-col items-center text-center gap-8">

        {/* Logo */}
        <div>
          <p className="text-[10px] tracking-[0.35em] uppercase text-cyan-400/50 mb-3">Welcome to</p>
          <h1 className="font-display text-5xl italic text-white leading-none">
            Neos<span className="text-cyan-400">is</span>
          </h1>
          <p className="text-[11px] text-zinc-600 mt-3 tracking-wide">
            AI executive assistant for engineering teams
          </p>
        </div>

        {/* Card */}
        <div className="w-full rounded-2xl border border-zinc-800 bg-zinc-900/60 backdrop-blur-xl px-8 py-8 flex flex-col gap-4">

          <a
            href="/api/auth/login?connection=google-oauth2"
            className="flex items-center justify-center gap-3 w-full py-3 rounded-xl border border-zinc-700 bg-zinc-800/60 hover:bg-zinc-700/60 hover:border-zinc-600 transition-all duration-150 text-[13px] text-zinc-200"
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4" xmlns="http://www.w3.org/2000/svg">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Continue with Google
          </a>

          <a
            href="/api/auth/login?connection=github"
            className="flex items-center justify-center gap-3 w-full py-3 rounded-xl border border-zinc-700 bg-zinc-800/60 hover:bg-zinc-700/60 hover:border-zinc-600 transition-all duration-150 text-[13px] text-zinc-200"
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4 fill-white" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 21.795 24 17.295 24 12c0-6.63-5.37-12-12-12z"/>
            </svg>
            Continue with GitHub
          </a>

          <div className="flex items-center gap-3 my-1">
            <div className="flex-1 h-px bg-zinc-800" />
            <span className="text-[10px] text-zinc-600 tracking-widest uppercase">or</span>
            <div className="flex-1 h-px bg-zinc-800" />
          </div>

          <a
            href="/api/auth/login"
            className="w-full py-3 rounded-xl border border-cyan-500/20 bg-cyan-950/20 hover:bg-cyan-950/40 hover:border-cyan-400/40 transition-all duration-150 text-[13px] text-cyan-400 text-center"
          >
            Sign in with email
          </a>
        </div>

        <p className="text-[10px] text-zinc-700 tracking-wide">
          By signing in you agree to let Neo read your tools.<br />
          OAuth tokens stored securely via Auth0.
        </p>
      </div>
    </div>
  );
}
