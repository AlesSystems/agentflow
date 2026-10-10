import { spawn, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, realpathSync, writeFileSync, lstatSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it.each(["file","payload","token"])("rejects an unwritten FIFO %s promptly without outbox or HTTP mutation",async kind=> {
  const dir=mkdtempSync(join(realpathSync(tmpdir()),"agentflow-p06-fifo-")),fifo=join(dir,"unwritten"),token=join(dir,"token"),input=join(dir,"input.json"),outbox=join(dir,"outbox");
  execFileSync("mkfifo",["-m","600",fifo]);writeFileSync(token,"a".repeat(64),{mode:0o600});writeFileSync(input,JSON.stringify({name:"Synthetic"}),{mode:0o600});
  let requests=0;
  const server=createServer((_req,res)=>{requests++;res.writeHead(500).end();});
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  const address=server.address();if(!address||typeof address==="string")throw new Error("fixture address missing");
  const args=kind==="payload"?["report","--run",randomUUID(),"--type","run.started","--payload",fifo]:["project","create","--file",kind==="file"?fifo:input,"--idempotency-key",randomUUID()];
  const before=lstatSync(fifo),start=performance.now();
  const child=spawn(process.execPath,["--import","tsx","src/cli/main.ts",...args],{env:{...process.env,PORT:String(address.port),AGENTFLOW_REPORTER_TOKEN_FILE:kind==="token"?fifo:token,AGENTFLOW_OUTBOX_DIR:outbox},stdio:["ignore","pipe","pipe"]});
  let stdout="",stderr="";child.stdout.on("data",chunk=>stdout+=chunk);child.stderr.on("data",chunk=>stderr+=chunk);
  const timer=setTimeout(()=>child.kill("SIGKILL"),6000);
  try {
    const code=await new Promise<number|null>(resolve=>child.on("exit",resolve));
    expect(code).toBe(1);expect(performance.now()-start).toBeLessThan(1500);
    expect(requests).toBe(0);expect(existsSync(outbox)).toBe(false);expect(lstatSync(fifo)).toEqual(before);
    expect(stdout).toBe("");expect(stderr).not.toContain(dir);expect(stderr).not.toContain("a".repeat(64));
  }finally{clearTimeout(timer);child.kill("SIGKILL");await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
