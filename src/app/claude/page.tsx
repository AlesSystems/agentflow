import { headers } from "next/headers";
import { privateContext } from "../../server/next-boundary";
import { Workspace } from "../../client/provider";
import { Shell, NeedsPairing } from "../../components/shell";
import { connectorId } from "../../contracts/connectors";
import { ConnectorHistory } from "../../components/connector";
export const dynamic = "force-dynamic";
export default async function Page({searchParams}: {searchParams: Promise<{chat?: string}>}) {
  const {chat} = await searchParams;
  const initialSelected = connectorId.safeParse(chat).success ? chat : null;
  let data;
  try {
    const state = privateContext(new Headers(await headers()), "human");
    data = { generation: state.owned.store.metadata().generation, hydration: { mutations: [], queries: [] } };
  } catch { return <NeedsPairing />; }
  return <Workspace {...data}><Shell><ConnectorHistory source="claude" initialSelected={initialSelected} /></Shell></Workspace>;
}
