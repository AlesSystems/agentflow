import "server-only";
import { queryPath } from "../client/queries";
import { headers } from "next/headers";
import { privateContext } from "./next-boundary";
import type { Store } from "../db";
import type { ApplicationQuery } from "../db/application";
import type { z } from "zod";
import { QueryClient, dehydrate } from "@tanstack/react-query";
export function sharedStoreSnapshot<S extends z.ZodType>(
  store: Store,
  query: ApplicationQuery,
  schema: S,
) {
  return schema.parse(store.snapshot(query, Date.now()).body);
}
export async function pageData<S extends z.ZodType>(
  path: string,
  query: ApplicationQuery,
  schema: S,
  additional: {
    path: string;
    query: ApplicationQuery;
    schema: z.ZodType;
  }[] = [],
) {
  try {
    const state = privateContext(new Headers(await headers()), "human");
    const generation = state.owned.store.metadata().generation;
    const cache = new QueryClient();
    try {
      cache.setQueryData(
        [generation, queryPath(path)],
        sharedStoreSnapshot(state.owned.store, query, schema),
      );
      for (const entry of additional)
        cache.setQueryData(
          [generation, queryPath(entry.path)],
          sharedStoreSnapshot(state.owned.store, entry.query, entry.schema),
        );
    } catch {}
    return {
      humanSession: true as const,
      generation,
      hydration: dehydrate(cache),
    };
  } catch {
    return null;
  }
}
