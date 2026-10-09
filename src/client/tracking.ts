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
  constructor(public after: string) {}
  offer(id: string, data: string) { const next = validatedChange(id, data, this.after); if (next) this.after = next; return next; }
  discardPending() {}
  flush(invalidate: () => void) { invalidate(); }
  rebase(_snapshots: unknown[], _generation: string) {}
}
