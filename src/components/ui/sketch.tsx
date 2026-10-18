import Image from "next/image";
import agentFlowLogo from "../../../docs/assets/agentflow-logo.png";

const strokes = [
  "M2 6c30-4 60-3 95-1s70 2 101-2",
  "M2 5c40-3 90-3 130-1s50 2 66 0",
  "M2 6c40-4 100-3 196-2",
  "M2 5c50-3 120-2 196 1",
  "M2 6c60-4 130-4 196-1",
];
export function Scribble({ variant = 0 }: { variant?: number }) {
  return (
    <svg className="scribble" viewBox="0 0 200 10" preserveAspectRatio="none" aria-hidden="true">
      <path d={strokes[variant % strokes.length]} fill="none" stroke="var(--clay)" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
export function BrandMark({ size = 34 }: { size?: number }) {
  return (
    <Image src={agentFlowLogo} width={size} height={size} alt="" aria-hidden="true" />
  );
}
export function EmptyNote({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="empty-note">
      <svg width="64" height="52" viewBox="0 0 64 52" aria-hidden="true" fill="none" stroke="var(--ink)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 10c10-1 24-1 34 0l2 34c-11 1-24 1-35 0z" />
        <path d="M14 20c7-.4 16-.4 23 0M14 28c5-.3 12-.3 18 0" />
        <path d="M44 30l12-14 4 3-12 14-6 2z" fill="var(--clay-tint)" />
      </svg>
      <div>
        <p className="hand">{title}</p>
        <p className="metadata">{children}</p>
      </div>
    </div>
  );
}
