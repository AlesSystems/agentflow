import { pageData } from "../../server/page-data";
import { settingsResponse } from "../../contracts/responses";
import { Workspace } from "../../client/provider";
import { Shell,NeedsPairing } from "../../components/shell";
import { Settings } from "../../components/settings";
export const dynamic="force-dynamic";
export default async function Page(){const data=await pageData("/settings",{kind:"settings"},settingsResponse);return data?<Workspace {...data}><Shell><Settings/></Shell></Workspace>:<NeedsPairing/>;}
