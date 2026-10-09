"use client";
import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";
import {
  QueryClient,
  QueryClientProvider,
  HydrationBoundary,
  useQuery,
  useQueryClient,
  type DehydratedState,
} from "@tanstack/react-query";
import { z } from "zod";
import { queryPath } from "./queries";
import { ApiClient, ApiError, StaleSnapshot } from "./api";
import { settingsResponse } from "../contracts/responses";
import { freezeCommand } from "./commands";
import { Modal } from "../components/ui/dialog";
import PairForm from "../app/pair/form";
const Context = createContext<{
  api: ApiClient;
  generation: string;
  pair: () => void;
} | null>(null);
export function BrowserCache({ children }: { children: React.ReactNode }) {
  const [cache] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
            staleTime: 5000,
            refetchOnWindowFocus: true,
          },
        },
      }),
  );
  return <QueryClientProvider client={cache}>{children}</QueryClientProvider>;
}
export function useWorkspace() {
  const context = useContext(Context);
  if (!context) throw new Error("Workspace missing");
  return context;
}
export function Workspace({
  generation: initial,
  hydration,
  children,
}: {
  generation: string;
  hydration: DehydratedState;
  children: React.ReactNode;
}) {
  const cache = useQueryClient();
  const [generation, setGeneration] = useState(initial);
  const [pairing, setPairing] = useState(false);
  const pair = useCallback(() => setPairing(true), []);
  const [api] = useState(
    () =>
      new ApiClient(initial, (next) => {
        cache.cancelQueries();
        cache.clear();
        setGeneration(next);
      }),
  );
  return (
    <Context.Provider value={{ api, generation, pair }}>
      <HydrationBoundary state={hydration}>
        <TimezoneInit />
        <Modal
          title="Pair again to keep editing"
          open={pairing}
          onClose={() => setPairing(false)}
        >
          <p>Your draft stays here. Reloading loses unsaved memory drafts.</p>
          <PairForm
            onPaired={() => {
              setPairing(false);
              void cache.invalidateQueries();
            }}
          />
        </Modal>
        {children}
      </HydrationBoundary>
    </Context.Provider>
  );
}
export function useRead<S extends z.ZodType>(
  path: string,
  schema: S,
  interval?: number,
) {
  const { api, generation, pair } = useWorkspace();
  const query = useQuery({
    queryKey: [generation, queryPath(path)],
    queryFn: () => api.read(queryPath(path), schema),
    refetchInterval: interval,
  });
  useEffect(() => {
    if (query.error instanceof ApiError && query.error.status === 401) pair();
  }, [query.error, pair]);
  return query;
}
function TimezoneInit() {
  const { api } = useWorkspace();
  const cache = useQueryClient();
  const query = useRead("/settings", settingsResponse);
  useEffect(() => {
    if (query.data?.data.version !== 1) return;
    let active = true;
    const command = freezeCommand("/settings", "PATCH", {
      expectedVersion: 1,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    });
    void api
      .command(command)
      .catch(() => {})
      .finally(() => {
        if (active) void cache.invalidateQueries();
      });
    return () => {
      active = false;
    };
  }, [query.data?.data.version, api, cache]);
  return null;
}
export function QueryFeedback({
  error,
  loading,
  retry,
}: {
  error: unknown;
  loading: boolean;
  retry: () => void;
}) {
  if (loading)
    return (
      <p role="status" className="loading">
        Loading workspace…
      </p>
    );
  if (!error) return null;
  return (
    <div role="alert" className="error">
      <p>
        {error instanceof StaleSnapshot
          ? "Workspace changed. Load a fresh snapshot."
          : error instanceof ApiError && error.status === 404
            ? "This record is unavailable. Return to Projects."
            : "Could not refresh this view. Your existing data is retained."}
      </p>
      <button onClick={retry}>Retry refresh</button>
    </div>
  );
}
