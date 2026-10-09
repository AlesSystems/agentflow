import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { expect, it } from "vitest";
import type { Store } from "../../src/db";
import { ChangeStreams } from "../../src/server/change-stream";
const generation = "10000000-0000-4000-8000-000000000001";
it("rejects a frame before enqueue when native bytes already consume the hard budget", async () => {
  const request = Object.assign(new EventEmitter(), { rawHeaders: [], method: "GET" });
  let writes = 0;
  let destroyed = false;
  const response = Object.assign(new EventEmitter(), {
    writableLength: 1048576, setHeader() {}, flushHeaders() {},
    write() { writes++; return false; }, destroy() { destroyed = true; },
  });
  const store = {
    session: () => ({ id: "synthetic" }),
    changeBatch: () => ({ generation, minimum: "1", maximum: "1", changes: [{ id: "1", data: { entityType: "task", entityId: "synthetic", kind: "updated" } }] }),
  } as unknown as Store;
  const streams = new ChangeStreams(store, { schemaVersion: 1, reporterToken: "r", pairingToken: "p" });
  await streams.serve(request as unknown as IncomingMessage, response as unknown as ServerResponse, new Headers({ Cookie: "agentflow_session=" + "a".repeat(64) }), new URL(`http://localhost/changes?after=0&generation=${generation}`));
  expect(writes).toBe(0);
  expect(destroyed).toBe(true);
  expect(streams.diagnostics().leases).toBe(0);
  expect(response.listenerCount("drain")).toBe(0);
  expect(request.listenerCount("aborted")).toBe(0);
});
