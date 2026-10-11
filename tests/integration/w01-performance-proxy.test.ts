import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { launch } from "../fixtures/server";
import { publicProxy } from "../fixtures/p06-proxy";
import { taskRegistrationResponse } from "../../src/contracts/task-registration";
it("captures actual preferred task creation without stripping its standard request header", async () => {
  const server = await launch();
  const headers = {
    Authorization: "Bearer " + server.credentials().reporterToken,
    "Content-Type": "application/json",
    "Idempotency-Key": randomUUID(),
  };
  const projectReply = await fetch(server.url + "/api/v1/projects", {
    method: "POST",
    headers,
    body: JSON.stringify({ name: "Synthetic preferred capture" }),
  });
  expect(projectReply.status).toBe(201);
  const projectId = (await projectReply.json()).data.id;
  const captured: unknown[] = [];
  const proxy = await publicProxy(server, (_req, body, reply) => {
    if (reply)
      captured.push({
        input: body.toString(),
        response: reply.body.toString(),
      });
    return undefined;
  });
  try {
    const response = await fetch(
      `http://127.0.0.1:${proxy.port}/api/v1/tasks`,
      {
        method: "POST",
        headers: {
          ...headers,
          "Idempotency-Key": randomUUID(),
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
          projectId,
          title: "Synthetic actual preference",
        }),
      },
    );
    const raw = await response.text();
    expect(response.status).toBe(201);
    expect(response.headers.get("preference-applied")).toBe("return=minimal");
    const task = taskRegistrationResponse.parse(JSON.parse(raw));
    expect(task.data.projectId).toBe(projectId);
    expect(captured).toHaveLength(1);
    expect((captured[0] as { response: string }).response).toBe(raw);
  } finally {
    await proxy.close();
    await server.stop();
  }
});
