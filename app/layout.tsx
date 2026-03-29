import type { Metadata } from "next";
import { UserProvider } from "@auth0/nextjs-auth0/client";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Neosis",
  description: "AI Executive Assistant for Engineering Teams",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-black text-white min-h-screen antialiased">
        <UserProvider>
          <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-8 py-5 border-b border-white/[0.05] bg-black/80 backdrop-blur-xl">
            <span className="text-xl tracking-tight text-white" style={{ fontFamily: "'Instrument Serif', serif" }}>
              Neos<span className="text-cyan-400">is</span>
            </span>
            <div className="flex items-center gap-6">
              <Link
                href="/settings"
                className="text-[10px] tracking-[0.25em] uppercase text-zinc-500 hover:text-cyan-400 transition-colors duration-200"
                style={{ fontFamily: "'JetBrains Mono', monospace" }}
              >
                Settings
              </Link>
              <Link
                href="/login"
                className="text-[10px] tracking-[0.25em] uppercase text-cyan-400 border border-cyan-500/20 rounded-lg px-3 py-1.5 hover:bg-cyan-950/30 hover:border-cyan-400/40 transition-all duration-150"
                style={{ fontFamily: "'JetBrains Mono', monospace" }}
              >
                Sign in
              </Link>
            </div>
          </nav>
          <main className="pt-[65px]">{children}</main>
        </UserProvider>
      </body>
    </html>
  );
}
