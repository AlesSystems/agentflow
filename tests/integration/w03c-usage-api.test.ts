import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { launch, pair } from "../fixtures/server";
import { usageResponse, priceSnapshotsResponse } from "../../src/contracts/usage";
import { historyLine } from "../../src/contracts/history";
it("native usage validates human prices, bounded queries, v2 export and original receipt with current headers", async () => {
    const stdout:Buffer[]=[],stderr:Buffer[]=[],requests:unknown[]=[];
    let closed:Promise<void>=Promise.resolve();
    const server=await launch({onChild:child=>{child.stdout!.on("data",chunk=>stdout.push(Buffer.from(chunk)));child.stderr!.on("data",chunk=>stderr.push(Buffer.from(chunk)));closed=new Promise(resolve=>child.once("close",()=>resolve()));}});
    const capture=async(method:string,path:string,input:unknown,response:Response)=>{requests.push({method,path,input,status:response.status,generation:response.headers.get("AgentFlow-Generation"),body:await response.clone().text()});return response;};
    try {
        const cookie = await pair(server), human = { Cookie: cookie, Origin: server.url, "Content-Type": "application/json" }, reporter = { Authorization: "Bearer " + server.credentials().reporterToken, "Content-Type": "application/json" };
        const get = async (path: string, headers: Record<string, string> = human) => capture("GET",path,null,await fetch(server.url + "/api/v1" + path, { headers }));
        const post = async (path: string, input: unknown, headers: Record<string, string> = human, key = randomUUID()) => capture("POST",path,input,await fetch(server.url + "/api/v1" + path, { method: "POST", headers: { ...headers, "Idempotency-Key": key }, body: JSON.stringify(input) }));
        const project = await (await post("/projects", { name: "Synthetic API usage" }, reporter)).json(), agent = await (await post("/agents", { displayName: "Fixture", source: "fixture", defaultRole: "orchestrator" }, reporter)).json();
        const runId = randomUUID();
        expect((await post("/runs", { id: runId, projectId: project.data.id, agentId: agent.data.id, purpose: "planning" }, reporter)).status).toBe(201);
        const now = new Date().toISOString();
        for (const [sequence, type, payload] of [[1, "run.started", {}], [2, "run.progress", { message: "Synthetic history" }], [3, "run.usage", { usageId: "stable", source: "fixture", model: "model", measuredAt: now, inputTokens: 2, outputTokens: 8, billingBasis: "input_output_only" }], [4, "run.succeeded", { summary: "Synthetic terminal" }]] as const)
            expect((await post(`/runs/${runId}/events`, { schemaVersion: 1, eventId: randomUUID(), runId, sequence, type, payload, occurredAt: now }, reporter)).status).toBe(201);
        const snapshot = { id: randomUUID(), name: "Local", capturedAt: now, entries: [{ source: "fixture", model: "model", currency: "USD", inputPrice: "1", outputPrice: "2" }] }, key = randomUUID();
        expect((await post("/usage/price-snapshots", snapshot, reporter, key)).status).toBe(403);
        const created = await post("/usage/price-snapshots", snapshot, human, key);
        expect(created.status).toBe(201);
        const original = await created.json();
        const list = await get("/usage/price-snapshots");
        expect(priceSnapshotsResponse.parse(await list.json()).data.items).toHaveLength(1);
        const from = new Date(Date.now() - 86400000).toISOString(), to = new Date(Date.now() + 86400000).toISOString(), query = `/usage?projectId=${project.data.id}&from=${from}&to=${to}&priceSnapshotId=${snapshot.id}`;
        const summary = await get(query, reporter);
        expect(summary.status).toBe(200);
        expect(usageResponse.parse(await summary.json()).data).toMatchObject({ filteredReportCount: 1, knownTotalTokens: "10", estimate: { includedReports: 1, currencies: [{ currency: "USD", amount: "0.000018" }] } });
        expect((await get(query + "&limit=101")).status).toBe(400);
        expect((await get(query + "&projectId=" + project.data.id)).status).toBe(400);
        expect((await get(query + "&unknown=1")).status).toBe(400);
        const before = await (await get("/foundation")).json(), exported = await get(`/export?content=attempts&generation=${before.generation}`);
        expect(exported.status).toBe(200);
        const lines = (await exported.text()).trim().split("\n").map(row => historyLine.parse(JSON.parse(row)));
        expect(lines[0]).toMatchObject({ kind: "manifest", schemaVersion: 2 });
        expect(lines.at(-1)).toMatchObject({ kind: "complete", schemaVersion: 2 });
        expect(lines.filter(r => r.kind === "usageMeasurement")).toHaveLength(1);
        expect(lines.filter(r => r.kind === "usagePriceSnapshot")).toHaveLength(1);
        const preview = await (await post("/retention/preview", { cutoff: new Date().toISOString() })).json();
        expect(preview.data.counts.eventPayloads).toBe(1);
        const prune = await post("/retention/prune", { previewId: preview.data.previewId, expectedGeneration: preview.data.expectedGeneration, expectedVersion: preview.data.expectedVersion, candidateDigest: preview.data.candidateDigest });
        expect(prune.status).toBe(200);
        const current = await prune.json();
        expect(current.generation).not.toBe(original.generation);
        const replay = await post("/usage/price-snapshots", snapshot, human, key);
        expect(replay.status).toBe(201);
        expect(replay.headers.get("AgentFlow-Generation")).toBe(current.generation);
        expect(await replay.json()).toEqual(original);
        expect((await post("/usage/price-snapshots", { ...snapshot, name: "Changed" }, human, key)).status).toBe(409);
        expect((await post("/usage/price-snapshots", snapshot, reporter, key)).status).toBe(403);
        expect(usageResponse.parse(await (await get(query)).json()).data.knownTotalTokens).toBe("10");
        const head = await fetch(server.url + "/api/v1/usage/price-snapshots", { method: "HEAD", headers: human });
        expect(head.status).toBe(200);
        expect(await head.text()).toBe("");
    }
    finally {
        await server.stop();await closed;
        if(process.env.AGENTFLOW_W03C_QUERY_PROOF_DIR)writeFileSync(join(process.env.AGENTFLOW_W03C_QUERY_PROOF_DIR,randomUUID()+".json"),JSON.stringify({cwd:process.cwd(),node:process.execPath,argv:server.child.spawnargs,dir:server.dir,exit:server.child.exitCode,signal:server.child.signalCode,stdoutBase64:Buffer.concat(stdout).toString("base64"),stderrBase64:Buffer.concat(stderr).toString("base64"),requests},null,2),{mode:0o600});
    }
}, 40000);
it("native UUID aliases preserve canonical prices, original body digests and bound cursors",async()=>{
 const stdout:Buffer[]=[],stderr:Buffer[]=[],requests:unknown[]=[];let closed:Promise<void>=Promise.resolve();const server=await launch({onChild:child=>{child.stdout!.on("data",chunk=>stdout.push(Buffer.from(chunk)));child.stderr!.on("data",chunk=>stderr.push(Buffer.from(chunk)));closed=new Promise(resolve=>child.once("close",()=>resolve()));}});
 const capture=async(method:string,path:string,input:unknown,response:Response)=>{requests.push({method,path,input,status:response.status,generation:response.headers.get("AgentFlow-Generation"),body:await response.clone().text()});return response;};
 try{const cookie=await pair(server),headers={Cookie:cookie,Origin:server.url,"Content-Type":"application/json"};const post=async(path:string,input:unknown,key=randomUUID())=>capture("POST",path,input,await fetch(server.url+"/api/v1"+path,{method:"POST",headers:{...headers,"Idempotency-Key":key},body:JSON.stringify(input)}));const get=async(path:string)=>capture("GET",path,null,await fetch(server.url+"/api/v1"+path,{headers}));
 const project=(await (await post("/projects",{name:"UUID reference fixture"})).json()).data.id,agent=(await (await post("/agents",{displayName:"Fixture",source:"fixture",defaultRole:"orchestrator"})).json()).data.id;
 const at=new Date().toISOString();for(let index=0;index<2;index++){const runId=randomUUID();expect((await post("/runs",{id:runId,projectId:project,agentId:agent,purpose:"planning"})).status).toBe(201);for(const [sequence,type,payload] of [[1,"run.started",{}],[2,"run.usage",{usageId:"OpaqueID",source:"OpaqueSource",model:"OpaqueModel",measuredAt:at,inputTokens:3,outputTokens:7,billingBasis:"input_output_only"}]] as const)expect((await post(`/runs/${runId}/events`,{schemaVersion:1,eventId:randomUUID(),runId,sequence,type,payload,occurredAt:at})).status).toBe(201);}
 const id=randomUUID(),key=randomUUID(),input={id:id.toUpperCase(),name:"Uppercase input",capturedAt:at,entries:[{source:"OpaqueSource",model:"OpaqueModel",currency:"USD",inputPrice:"1",outputPrice:"2"}]};const created=await post("/usage/price-snapshots",input,key);expect(created.status).toBe(201);const original=await created.json();expect(original.data.id).toBe(id);expect(await (await post("/usage/price-snapshots",input,key)).json()).toEqual(original);const changed=await post("/usage/price-snapshots",{...input,id},key);expect(changed.status).toBe(409);expect((await changed.json()).error.code).toBe("idempotency_conflict");const duplicate=await post("/usage/price-snapshots",{...input,id});expect(duplicate.status).toBe(409);expect((await duplicate.json()).error.code).toBe("price_snapshot_conflict");
 const from=new Date(Date.now()-86400000).toISOString(),to=new Date(Date.now()+86400000).toISOString(),lower=`/usage?projectId=${project}&priceSnapshotId=${id}&from=${from}&to=${to}&source=OpaqueSource&model=OpaqueModel&limit=1`,upper=lower.replace(project,project.toUpperCase()).replace(id,id.toUpperCase());const first=usageResponse.parse(await (await get(upper)).json());expect(first.data).toMatchObject({projectId:project,eligibleRuns:2,filteredReportCount:2,knownTotalTokens:"20",estimate:{snapshot:{id},includedReports:2}});expect(first.data.runDetails).toHaveLength(1);expect(first.data.nextCursor).toBeTypeOf("string");const next=usageResponse.parse(await (await get(lower+"&cursor="+first.data.nextCursor)).json());expect(next.data.runDetails).toHaveLength(1);expect(next.data.runDetails[0].runId).not.toBe(first.data.runDetails[0].runId);expect(usageResponse.parse(await (await get(lower.replace("OpaqueSource","opaquesource"))).json()).data.filteredReportCount).toBe(0);
 }finally{await server.stop();await closed;if(process.env.AGENTFLOW_W03C_QUERY_PROOF_DIR)writeFileSync(join(process.env.AGENTFLOW_W03C_QUERY_PROOF_DIR,randomUUID()+".json"),JSON.stringify({cwd:process.cwd(),node:process.execPath,argv:server.child.spawnargs,dir:server.dir,exit:server.child.exitCode,signal:server.child.signalCode,stdoutBase64:Buffer.concat(stdout).toString("base64"),stderrBase64:Buffer.concat(stderr).toString("base64"),requests},null,2),{mode:0o600});}
},40000);
