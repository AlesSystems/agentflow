import type { Metadata } from "next";
import "./globals.css";
import { BrowserCache } from "../client/provider";
export const metadata: Metadata = {
  title: "AgentFlow",
  description: "Your local work, with reported evidence.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <BrowserCache>{children}</BrowserCache>
      </body>
    </html>
  );
}
