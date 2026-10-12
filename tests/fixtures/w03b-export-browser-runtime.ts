import { createInterface } from "node:readline";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { startRuntime } from "../../src/server/launcher";
import { readConfig } from "../../src/server/config";
const emit = (value: unknown) => console.log("EXPORT_TEST " + JSON.stringify(value));
const running = await startRuntime(readConfig(process.env, "production"));
let hold = false, release = () => {}, readersClosed = 0;
const prepare = running.owned.store.prepareHistoryExport.bind(running.owned.store);
running.owned.store.prepareHistoryExport = async (...args) => {
  const snapshot = await prepare(...args), close = snapshot.close.bind(snapshot);
  snapshot.close = () => { close(); readersClosed++; };
  if (hold) {
    hold = false;
    emit({ event: "copied", manifest: snapshot.manifest });
    await new Promise<void>(resolve => { release = resolve; });
  }
  return snapshot;
};
const serve = running.history.serveExport.bind(running.history);
running.history.serveExport = async (request, response, headers, url) => {
  const chunks: Buffer[] = [], write = response.write.bind(response);
  response.write = ((chunk: string | Buffer, ...args: unknown[]) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return Reflect.apply(write, response, [chunk, ...args]) as boolean;
  }) as typeof response.write;
  response.once("close", () => emit({ event: "wire", status: response.statusCode, generation: response.getHeader("AgentFlow-Generation"), body: Buffer.concat(chunks).toString("utf8") }));
  await serve(request, response, headers, url);
};
createInterface({ input: process.stdin }).on("line", line => {
  if (line === "hold") { hold = true; emit({ event: "held" }); }
  if (line === "release") { release(); emit({ event: "released" }); }
  if (line === "diagnostics") emit({ event: "diagnostics", history: running.history.diagnostics(), readersClosed, exports: readdirSync(join(running.owned.store.dataDir, "exports")) });
});
process.once("SIGTERM", () => { release(); void running.shutdown().then(() => process.exit(0)); });
emit({ event: "ready" });
