import { pageData } from "../server/page-data";
import { overviewResponse } from "../contracts/responses";
import { Workspace } from "../client/provider";
import { Shell, NeedsPairing } from "../components/shell";
import { Overview } from "../components/overview";
export const dynamic="force-dynamic";
export default async function Home(){const data=await pageData("/overview?limit=50",{kind:"overview",input:{limit:50}},overviewResponse);if(!data)return <NeedsPairing/>;return <Workspace {...data}><Shell><Overview/></Shell></Workspace>;}
