import {it,expect} from "vitest";
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {spawnSync} from "node:child_process";
it("opens an initialized outbox under the native publication lease before mutable accounting",()=>{
 const root=mkdtempSync(join(tmpdir(),"p07-warm-accounting-"));for(const name of ["service","outbox"])mkdirSync(join(root,name),{mode:0o700});
 const child=spawnSync(process.execPath,["--import","tsx","tests/fixtures/p07-warm-accounting.mjs",root],{encoding:"utf8",timeout:15000});
 writeFileSync(join(root,"child.json"),JSON.stringify({status:child.status,signal:child.signal,stdout:child.stdout,stderr:child.stderr}),{mode:0o600});
 const facts=JSON.parse(readFileSync(join(root,"result.json"),"utf8"));
 expect({status:child.status,outcome:facts.outcome,code:facts.primary?.code}).toEqual({status:0,outcome:"returned",code:undefined});
});

it.each(["quota","reservation"])("checks warm %s under native publication ownership",scenario=>{
 const root=mkdtempSync(join(tmpdir(),"p07-warm-accounting-"));for(const name of ["service","outbox"])mkdirSync(join(root,name),{mode:0o700});
 const child=spawnSync(process.execPath,["--import","tsx","tests/fixtures/p07-warm-accounting.mjs",root,scenario],{encoding:"utf8",timeout:15000});
 writeFileSync(join(root,"child.json"),JSON.stringify({status:child.status,signal:child.signal,stdout:child.stdout,stderr:child.stderr}),{mode:0o600});
 const facts=JSON.parse(readFileSync(join(root,"result.json"),"utf8"));
 expect({status:child.status,code:facts.primary?.code}).toEqual({status:0,code:"bootstrap_full"});
 expect(facts.timeline.map((x:{phase:string})=>x.phase)).toContain("reader-BEGIN-attempt");
});
