import { test,expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { launch } from "../fixtures/server";
import { registeredRun } from "../fixtures/p06-cli";
import { pairPage } from "../fixtures/p03";
import { plan,targets } from "../fixtures/p07-protocol";
import { confirm } from "../fixtures/p07-load";
test("actual observer matches two-frame visible identity and rejects absent wrong-run and hidden targets before timing",async({page})=>{
  const server=await launch();
  try{
    const f=await registeredRun(server),headers={Authorization:"Bearer "+server.credentials().reporterToken,"Content-Type":"application/json"};
    await fetch(server.url+`/api/v1/runs/${f.runId}/events`,{method:"POST",headers,body:JSON.stringify({schemaVersion:1,eventId:randomUUID(),runId:f.runId,sequence:1,type:"run.started",occurredAt:new Date().toISOString(),payload:{}})});
    const row=targets(plan([f.runId,randomUUID()],0,true))[0];
    const response=await fetch(server.url+`/api/v1/runs/${f.runId}/events`,{method:"POST",headers,body:JSON.stringify(row.event.body)});expect(response.status).toBe(201);const ack=await response.json();
    await pairPage(page,server);await page.goto(server.url+`/activity?projectId=${f.projectId}`);await expect(page.getByText(row.event.message!,{exact:true})).toBeVisible();
    expect(await confirm(page,row)).toMatchObject({receivedAt:ack.data.receivedAt,twoFrames:true});
    expect(row.observedReceipt).toBe(ack.data.receivedAt);
    const wrong=structuredClone(row);wrong.event.body.runId=randomUUID();expect(await confirm(page,wrong)).toBeNull();
    wrong.event.body.runId=f.runId;wrong.event.message="absent immutable target";expect(await confirm(page,wrong)).toBeNull();
    await page.locator(".activity-list .preserve-lines").first().evaluate(el=>(el as HTMLElement).style.visibility="hidden");
    expect(await confirm(page,row)).toBeNull();
  }finally{await server.stop();}
});
