import "server-only";
import { headers } from "next/headers";
import { privateContext } from "./next-boundary";
import type { ApplicationQuery } from "../db/application";
import type { z } from "zod";
import { QueryClient, dehydrate } from "@tanstack/react-query";
export async function pageData<S extends z.ZodType>(path:string,query:ApplicationQuery,schema:S){
 try {const state=privateContext(new Headers(await headers()),"human");const body=schema.parse(state.owned.store.snapshot(query,Date.now()).body);const generation=state.owned.store.metadata().generation;const cache=new QueryClient();cache.setQueryData([generation,path],body);return {generation,hydration:dehydrate(cache)};}catch{return null;}
}
