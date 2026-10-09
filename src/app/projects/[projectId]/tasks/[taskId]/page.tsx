import { pageData } from "../../../../../server/page-data";
import { taskDetailResponse } from "../../../../../contracts/responses";
import { Workspace } from "../../../../../client/provider";
import { Shell,NeedsPairing } from "../../../../../components/shell";
import { TaskPage } from "../../../../../components/tasks/page";
export const dynamic="force-dynamic";
export default async function Page({params}:{params:Promise<{projectId:string;taskId:string}>}){const {projectId,taskId}=await params;const data=await pageData(`/tasks/${taskId}`,{kind:"task",id:taskId,input:{history:"both",historyLimit:50}},taskDetailResponse);return data?<Workspace {...data}><Shell><TaskPage projectId={projectId} taskId={taskId}/></Shell></Workspace>:<NeedsPairing/>;}
