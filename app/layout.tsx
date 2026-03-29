import type { Metadata } from "next";
import { UserProvider } from "@auth0/nextjs-auth0/client";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Neosis",
  description: "The Affordable AI Executive Assistant",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-black text-white min-h-screen antialiased">
        <UserProvider>
          {/* Nav */}
          <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-8 py-5 border-b border-white/[0.05] bg-black/80 backdrop-blur-xl">
            <span className="text-xl tracking-tight text-white" style={{ fontFamily: "'Instrument Serif', serif" }}>
              Neos<span className="text-cyan-400">is</span>
            </span>
            <div className="flex items-center gap-4">
              <Link
                href="/neo"
                className="text-[10px] tracking-[0.25em] uppercase text-cyan-300 hover:text-cyan-200 transition-colors duration-200"
                style={{ fontFamily: "'JetBrains Mono', monospace" }}
              >
                Launch Neo
              </Link>
              <Link
                href="/dashboard"
                className="text-[10px] tracking-[0.25em] uppercase text-zinc-500 hover:text-cyan-400 transition-colors duration-200"
                style={{ fontFamily: "'JetBrains Mono', monospace" }}
              >
                Dashboard
              </Link>
              <Link
                href="/auth"
                className="text-[10px] tracking-[0.25em] uppercase text-zinc-500 hover:text-cyan-400 transition-colors duration-200"
                style={{ fontFamily: "'JetBrains Mono', monospace" }}
              >
                Account
              </Link>
              <Link
                href="/settings"
                className="text-[10px] tracking-[0.25em] uppercase text-zinc-500 hover:text-cyan-400 transition-colors duration-200"
                style={{ fontFamily: "'JetBrains Mono', monospace" }}
              >
                Settings
              </Link>
            </div>
          </nav>
          <main className="pt-[65px]">{children}</main>
        </UserProvider>
      </body>
    </html>
  );
}
