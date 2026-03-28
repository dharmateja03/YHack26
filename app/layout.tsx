import type { Metadata } from "next";
import { UserProvider } from "@auth0/nextjs-auth0/client";
import "./globals.css";

export const metadata: Metadata = {
  title: "Neosis",
  description: "AI Executive Assistant for Engineering Teams",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-zinc-950 text-white min-h-screen">
        <UserProvider>
          <nav className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
            <span className="text-lg font-semibold tracking-tight">Neosis</span>
            <a
              href="/settings"
              className="text-sm text-zinc-400 hover:text-white transition-colors"
            >
              Settings
            </a>
          </nav>
          <main>{children}</main>
        </UserProvider>
      </body>
    </html>
  );
}
