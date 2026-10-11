import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import type { ChildProcess } from "node:child_process";
import { launch } from "../fixtures/server";
function childFixture(mode: string) {
 const dir = mkdtempSync(join(tmpdir(), "w03a-control-"));
 const entry = join(dir, "child.mjs");
 writeFileSync(entry, `import {createServer} from 'node:http'; console.log('original stdout'); console.error('original stderr'); ${mode === "startup" ? "process.exit(7);" : "const server=createServer((q,r)=>r.end('{}')); server.listen(Number(process.env.PORT),'127.0.0.1'); process.on('SIGTERM',()=>server.close(()=>{console.log('drained stdout');console.error('drained stderr');process.exit(0)}));"}`);
 return { dir, entry, bounds: { startupMs: 1500, healthMs: 100, terminateMs: 300, killMs: 300 } };
}
for (const mode of ["ready", "startup"]) it(`captures separate original child streams through ${mode} close`, async () => {
 let stdout = "", stderr = "", closed = false;
 const onChild = (child: ChildProcess) => { child.stdout!.on("data", chunk => stdout += chunk); child.stderr!.on("data", chunk => stderr += chunk); child.once("close", () => { closed = true; }); };
 const options = { ...childFixture(mode), onChild };
 if (mode === "startup") await expect(launch(options)).rejects.toThrow("launch exited 7");
 else { const server = await launch(options); await server.stop(); }
 expect(stdout).toContain("original stdout"); expect(stderr).toContain("original stderr"); expect(closed).toBe(true);
 if (mode === "ready") { expect(stdout).toContain("drained stdout"); expect(stderr).toContain("drained stderr"); }
});
