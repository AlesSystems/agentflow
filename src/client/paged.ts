import { useEffect, useRef, useState } from "react";
import type { z } from "zod";
import { useRead, useWorkspace } from "./provider";
type Page<T> = { data: { items: T[]; nextCursor: string | null; total: number }; snapshotCursor: string; generation: string };
export function usePaged<T>(path: string, schema: z.ZodType<Page<T>>) {
  const query = useRead(path, schema);
  const { api, generation, pair } = useWorkspace();
  const [extra, setExtra] = useState<T[]>([]), [next, setNext] = useState<string | null | undefined>(), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const scope = `${generation}:${path}:${query.dataUpdatedAt}`;
  const live = useRef(scope);
  useEffect(() => { live.current = scope; }, [scope]);
  const [captured, setCaptured] = useState(scope);
  if (captured !== scope) { setCaptured(scope); setExtra([]); setNext(undefined); setError(""); }
  async function more() {
    const cursor = next === undefined ? query.data?.data.nextCursor : next;
    if (!cursor || busy) return;
    const original = live.current;
    setBusy(true); setError("");
    try {
      const result = await api.read(`${path}${path.includes("?") ? "&" : "?"}cursor=${encodeURIComponent(cursor)}`, schema);
      if (original !== live.current || result.generation !== generation) return;
      if (result.snapshotCursor !== query.data?.snapshotCursor) { void query.refetch(); return; }
      setExtra(old => [...old, ...result.data.items]); setNext(result.data.nextCursor);
    } catch (error) {
      if (original === live.current) setError("Could not load this page. Retry load more.");
      if (error instanceof Error && "status" in error && error.status === 401) pair();
    } finally { setBusy(false); }
  }
  return { query, items: [...(query.data?.data.items ?? []), ...extra], next: next === undefined ? query.data?.data.nextCursor : next, error, busy, more };
}
