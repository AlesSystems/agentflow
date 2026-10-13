import Link from "next/link";
import { ConnectionStatus } from "./connection";
import { ProjectSwitcher } from "./project-switcher";
import { BrandMark } from "./ui/sketch";
import SignOut from "../app/sign-out";
export function Shell({
  children,
  projectId,
  wide = false,
}: {
  children: React.ReactNode;
  projectId?: string;
  wide?: boolean;
}) {
  return (
    <>
      <header className="topbar">
        <Link href="/" className="brand">
          <BrandMark />
          AgentFlow
        </Link>
        <nav aria-label="Main navigation">
          <ProjectSwitcher projectId={projectId} />
        </nav>
        <div className="topbar-end">
          <ConnectionStatus />
          <Link href="/settings" className="button icon-button" aria-label="Settings" title="Settings">
            <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <circle cx="10" cy="10" r="2.8" />
              <path d="M10 2.5v2.2M10 15.3v2.2M2.5 10h2.2M15.3 10h2.2M4.7 4.7l1.6 1.6M13.7 13.7l1.6 1.6M4.7 15.3l1.6-1.6M13.7 6.3l1.6-1.6" />
            </svg>
          </Link>
          <SignOut />
        </div>
      </header>
      <main id="main-content" className={wide ? "dash" : "page"}>
        {children}
      </main>
    </>
  );
}
export function NeedsPairing() {
  return (
    <main id="main-content" className="pair-page">
      <span className="brand">
        <BrandMark />
        AgentFlow
      </span>
      <h1>Pair this browser to continue</h1>
      <p>
        Your workspace requires a paired browser and the local AgentFlow
        launcher.
      </p>
      <Link className="button primary" href="/pair">
        Open browser pairing
      </Link>
    </main>
  );
}
