import { useLayoutEffect, useRef, useState } from "react";
import type { z } from "zod";
import { ApiError } from "./api";
import { useRead, useWorkspace } from "./provider";
type Rows<T> = { items: T[]; nextCursor: string | null; total: number };
type Page<T> = { data: Rows<T>; snapshotCursor: string; generation: string };
export function usePaged<T>(path: string, schema: z.ZodType<Page<T>>) {
  return usePageRows(path, schema, value => value.data);
}
export function usePageRows<T, S extends z.ZodType<{ snapshotCursor: string; generation: string }>>(path: string, schema: S, select: (value: z.infer<S>) => Rows<T>, identity?: (item: T) => string) {
  const query = useRead(path, schema);
  const { api, generation, pair } = useWorkspace();
  const [extra, setExtra] = useState<T[]>([]), [next, setNext] = useState<string | null | undefined>(), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [resetNotice, setResetNotice] = useState("");
  const scope = `${generation}:${path}:${query.dataUpdatedAt}:${query.data?.snapshotCursor ?? ""}`;
  const live = useRef(scope); useLayoutEffect(() => { live.current = scope; }, [scope]);
  const [captured, setCaptured] = useState(scope);
  if (captured !== scope) { setCaptured(scope); setExtra([]); setNext(undefined); setError(""); }
  const first = query.data ? select(query.data) : undefined;
  async function more() {
    const cursor = next === undefined ? first?.nextCursor : next;
    if (!cursor || busy) return;
    const original = live.current, snapshot = query.data?.snapshotCursor;
    setBusy(true); setError("");
    const reset = () => { setExtra([]); setNext(undefined); setResetNotice("History changed. Pages were reset to a fresh snapshot. Your drafts are retained."); void query.refetch(); };
    try {
      const result = await api.read(`${path}${path.includes("?") ? "&" : "?"}cursor=${encodeURIComponent(cursor)}`, schema);
      if (original !== live.current || result.generation !== api.generation) return;
      if (result.snapshotCursor !== snapshot) { reset(); return; }
      setExtra(old => [...old, ...select(result).items]); setNext(select(result).nextCursor);
    } catch (error) {
      if (error instanceof ApiError && [400, 409].includes(error.status) && error.code === "cursor_invalid" && live.current.startsWith(`${generation}:${path}:`)) reset();
      else if (original === live.current) setError("Could not load this page. Retry load more.");
      if (error instanceof ApiError && error.status === 401) pair();
    } finally { setBusy(false); }
  }
  const rows = [...(first?.items ?? []), ...extra];
  const items = identity ? [...new Map(rows.map(item => [identity(item), item])).values()] : rows;
  return { query, items, next: next === undefined ? first?.nextCursor : next, error, resetNotice, busy, more };
}
