import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { expect, it } from "vitest";
import { cliFixture } from "../fixtures/p06-cli";
import { launch } from "../fixtures/server";

it.each(["env-upper", "env-lower", "startup-upper", "startup-lower"])("keeps actual CLI registration direct with %s proxy configuration", async mode => {
  const server = await launch();
  let requests = 0, connects = 0, bearer = false;
  const proxy = createServer((req, res) => { requests++; bearer ||= Boolean(req.headers.authorization); res.writeHead(502).end(); });
  proxy.on("connect", (req, socket) => { connects++; bearer ||= Boolean(req.headers.authorization); socket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n"); });
  await new Promise<void>(resolve => proxy.listen(0,"127.0.0.1",resolve));
  const address = proxy.address();
  if (!address || typeof address === "string") throw new Error("fixture address missing");
  const url = `http://127.0.0.1:${address.port}`;
  const overrides: Record<string,string | undefined> = { HTTP_PROXY:undefined,HTTPS_PROXY:undefined,http_proxy:undefined,https_proxy:undefined,NO_PROXY:"",no_proxy:"",NODE_USE_ENV_PROXY:undefined,NODE_OPTIONS:undefined };
  if (mode.includes("upper")) { overrides.HTTP_PROXY=url; overrides.HTTPS_PROXY=url; }
  else { overrides.http_proxy=url; overrides.https_proxy=url; }
  if (mode.startsWith("env")) overrides.NODE_USE_ENV_PROXY="1";
  else overrides.NODE_OPTIONS="--use-env-proxy";
  const fixture = cliFixture(server);
  try {
    const result = await fixture.cli(["project","create","--file",fixture.file({name:"Direct synthetic"}),"--idempotency-key",randomUUID()],overrides);
    expect({requests,connects,bearer}).toEqual({requests:0,connects:0,bearer:false});
    expect(result.code).toBe(0);
    expect(Object.keys(JSON.parse(result.stdout)).sort()).toEqual(["generation","id"]);
  } finally { await new Promise<void>(resolve => proxy.close(() => resolve())); await server.stop(); }
});
