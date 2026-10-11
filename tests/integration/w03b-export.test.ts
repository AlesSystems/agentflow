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
    const lines = (await response.text()).trim().split("\n").map(line => JSON.parse(line));
    expect(lines[0]).toMatchObject({kind:"manifest",schemaVersion:1,generation:foundation.generation,content:["tasks"]});
    expect(lines.at(-1)).toEqual({kind:"complete",schemaVersion:1,counts:lines[0].counts});
    const records = lines.slice(1,-1);
    for (const [kind,count] of Object.entries(lines[0].counts)) expect(records.filter(row=>row.kind===kind)).toHaveLength(count as number);
    expect(records.find(row=>row.kind==="project").data.name).toBe("Synthetic history");
    expect(JSON.stringify(lines)).not.toContain("/synthetic/excluded-project-path");
    expect(records.some(row=>["run","workflow","connection"].includes(row.kind))).toBe(false);
  } finally { await server.stop(); }
}, 40000);
