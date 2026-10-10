import { changeCursor } from "../contracts/common";
import { changeFrame } from "../contracts/stream";
export type Connection = {
  state: "connecting" | "connected" | "polling" | "recovering" | "authentication-required";
  lastSuccess: number | null;
};
export function safeCursor(snapshots: unknown[], generation: string): string {
  const cursors = snapshots.flatMap((value) => {
    if (!value || typeof value !== "object" || !("generation" in value) || value.generation !== generation || !("snapshotCursor" in value)) return [];
    const cursor = changeCursor.safeParse(value.snapshotCursor);
    return cursor.success ? [cursor.data] : [];
  });
  return cursors.reduce((lowest, next) => BigInt(next) < BigInt(lowest) ? next : lowest, cursors[0] ?? "0");
}
export function validatedChange(id: string, data: string, after: string): string | null {
  const frame = changeFrame.parse({ id, data: JSON.parse(data) });
  return BigInt(frame.id) > BigInt(after) ? frame.id : null;
}
export class ReplayCursor {
  private pending: string | null = null;
  constructor(public after: string) {}
  offer(id: string, data: string) {
    const next = validatedChange(id, data, this.pending ?? this.after);
    if (next) this.pending = next;
    return next;
  }
  discardPending() { this.pending = null; }
  flush(invalidate: () => void) {
    if (!this.pending) return;
    invalidate();
    this.after = this.pending;
    this.pending = null;
  }
  rebase(snapshots: unknown[], generation: string) {
    this.discardPending();
    this.after = safeCursor(snapshots, generation);
  }
}
