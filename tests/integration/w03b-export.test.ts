import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { launch, pair } from "../fixtures/server";
it("exports_one_copy_with_exact_selected_counts", async () => {
  const server = await launch();
  try {
    const cookie = await pair(server);
    const headers = { Cookie: cookie };
    const foundation = await (await fetch(server.url + "/api/v1/foundation", { headers })).json();
    const project = await fetch(server.url + "/api/v1/projects", {method:"POST", headers:{...headers,Origin:server.url,"Content-Type":"application/json","Idempotency-Key":randomUUID()},body:JSON.stringify({name:"Synthetic history",repositoryPath:"/synthetic/excluded-project-path"})});
    expect(project.status).toBe(201);
    const response = await fetch(server.url + `/api/v1/export?content=tasks&generation=${foundation.generation}`, {headers});
    expect(response.status).toBe(200);
    expect(response.headers.get("content-encoding")).toBe(null);
    const lines = (await response.text()).trim().split("\n").map(line => JSON.parse(line));
    expect(lines[0]).toMatchObject({kind:"manifest",schemaVersion:2,generation:foundation.generation,content:["tasks"]});
    expect(lines.at(-1)).toEqual({kind:"complete",schemaVersion:2,counts:lines[0].counts});
    const records = lines.slice(1,-1);
    for (const [kind,count] of Object.entries(lines[0].counts)) expect(records.filter(row=>row.kind===kind)).toHaveLength(count as number);
    expect(records.find(row=>row.kind==="project").data.name).toBe("Synthetic history");
    expect(JSON.stringify(lines)).not.toContain("/synthetic/excluded-project-path");
    expect(records.some(row=>["run","workflow","connection"].includes(row.kind))).toBe(false);
  } finally { await server.stop(); }
}, 40000);

import { spawn } from "node:child_process";
it("proves production projections, selected counts, pressure, interruption, admission and shutdown", async () => {
  const child=spawn(process.execPath,["--import","tsx","tests/fixtures/w03b-export.ts"],{stdio:["ignore","pipe","pipe"]});
  let stdout="",stderr="";child.stdout.on("data",chunk=>stdout+=chunk);child.stderr.on("data",chunk=>stderr+=chunk);
  const timer=setTimeout(()=>child.kill("SIGKILL"),45000);
  const exit=await new Promise<number|null>(resolve=>child.once("close",resolve));clearTimeout(timer);
  expect(exit,stdout+stderr).toBe(0);
  expect(stdout).toContain('"outbound":0');
},50000);

it("keeps the registered Next fallback unavailable with no second export transport",async()=>{
  const native=await launch();const cookie=await pair(native);const dir=native.dir;await native.stop();
  const plain=await launch({dir,plain:true});
  try {const response=await fetch(plain.url+"/api/v1/export?content=tasks&generation=10000000-0000-4000-8000-000000000004",{headers:{Cookie:cookie}});expect(response.status).toBe(503);expect(response.headers.get("content-type")).not.toBe("application/x-ndjson");}
  finally{await plain.stop();}
},40000);
