import Link from "next/link";
import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "AgentFlow",
  description: "Your local work, with reported evidence.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header>
          <Link href="/">AgentFlow</Link>
          <span>Local workspace</span>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
