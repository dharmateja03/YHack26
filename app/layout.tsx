import type { Metadata } from "next";
import { UserProvider } from "@auth0/nextjs-auth0/client";
import Nav from "@/components/Nav";
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
          <Nav />
          <main className="pt-[65px]">{children}</main>
        </UserProvider>
      </body>
    </html>
  );
}
