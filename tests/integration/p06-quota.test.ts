import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect,it } from "vitest";
import { launch } from "../fixtures/server";
import { registeredRun } from "../fixtures/p06-cli";
import { seedRunToBytes,logicalBytes,RUN_BYTES } from "../fixtures/p06-quota";
import { openOutbox } from "../../src/cli/outbox";
import { canonicalDigest } from "../../src/domain/request-digest";
it("charges registration metadata globally and permits a run journal that exactly fits its own run ceiling",async()=> {
  const server=await launch(),f=await registeredRun(server);
  try {
    const key=randomUUID(),body={id:f.runId,projectId:f.projectId,agentId:f.agentId,purpose:"planning"};
    const meta=JSON.parse(readFileSync(join(f.env.AGENTFLOW_OUTBOX_DIR,"metadata.json"),"utf8"));
    const journal={formatVersion:1,key,path:"/runs",body,digest:canonicalDigest(body),order:meta.nextOrder};
    const journalBytes=Buffer.byteLength(JSON.stringify(journal));
    seedRunToBytes(f.env.AGENTFLOW_OUTBOX_DIR,f.runId,RUN_BYTES-journalBytes);
    const outbox=await openOutbox({port:server.port,token:server.credentials().reporterToken,outbox:f.env.AGENTFLOW_OUTBOX_DIR,explicitService:undefined},performance.now()+5000);
    try {expect(await outbox.preserveRegistration("/runs",key,body)).toEqual(journal);}finally{outbox.close();}
    expect(logicalBytes(join(f.env.AGENTFLOW_OUTBOX_DIR,f.runId))+readFileSync(join(f.env.AGENTFLOW_OUTBOX_DIR,`registration-${key}.json`)).length).toBe(RUN_BYTES);
  } finally{await server.stop();}
});
