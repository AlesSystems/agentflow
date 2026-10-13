import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { BrowserCache } from "../client/provider";
const body = localFont({
  src: [
    { path: "./fonts/atkinson-hyperlegible-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/atkinson-hyperlegible-latin-400-italic.woff2", weight: "400", style: "italic" },
    { path: "./fonts/atkinson-hyperlegible-latin-700-normal.woff2", weight: "700", style: "normal" },
    { path: "./fonts/atkinson-hyperlegible-latin-700-italic.woff2", weight: "700", style: "italic" },
  ],
  variable: "--font-body",
  display: "swap",
});
const hand = localFont({
  src: [
    { path: "./fonts/kalam-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/kalam-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-hand",
  display: "swap",
});
export const metadata: Metadata = {
  title: "AgentFlow",
  description: "Your local work, with reported evidence.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${body.variable} ${hand.variable}`}>
      <body>
        <svg width="0" height="0" className="sketch-defs" aria-hidden="true" focusable="false">
          <filter id="pencil" x="-2%" y="-2%" width="104%" height="104%">
            <feTurbulence type="fractalNoise" baseFrequency="0.022" numOctaves="3" seed="7" result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="3" xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </svg>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <BrowserCache>{children}</BrowserCache>
      </body>
    </html>
  );
}
