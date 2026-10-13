import { headers } from "next/headers";
import { privateContext } from "../../server/next-boundary";
import { Workspace } from "../../client/provider";
import { Shell, NeedsPairing } from "../../components/shell";
import { codexId } from "../../contracts/codex";
import { Codex } from "../../components/codex";
export const dynamic = "force-dynamic";
export default async function Page({searchParams}: {searchParams: Promise<{chat?: string}>}) {
  const {chat} = await searchParams;
  const initialSelected = codexId.safeParse(chat).success ? chat : null;
  let data;
  try {
    const state = privateContext(new Headers(await headers()), "human");
    data = { generation: state.owned.store.metadata().generation, hydration: { mutations: [], queries: [] } };
  } catch { return <NeedsPairing />; }
  return <Workspace {...data}><Shell><Codex initialSelected={initialSelected} /></Shell></Workspace>;
}
