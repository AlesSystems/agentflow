import Link from "next/link";
import SignOut from "../app/sign-out";
export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="workspace-shell">
      <nav className="rail" aria-label="Main navigation">
        <Link href="/" className="brand">
          AgentFlow
        </Link>
        <span className="local-label">Local workspace</span>
        <Link href="/">Overview</Link>
        <Link href="/projects">Projects</Link>
        <Link href="/settings">Settings</Link>
        <div className="rail-bottom">
          <SignOut />
        </div>
      </nav>
      <main id="main-content" className="workspace-main">
        {children}
      </main>
    </div>
  );
}
export function NeedsPairing() {
  return (
    <main className="pair-page">
      <h1>Pair this browser to continue</h1>
      <p>
        Your workspace requires a paired browser and the local AgentFlow
        launcher.
      </p>
      <Link href="/pair">Open browser pairing</Link>
    </main>
  );
}
