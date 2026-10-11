import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { launch } from "../fixtures/server";
import { publicProxy } from "../fixtures/p06-proxy";
import { registeredRun } from "../fixtures/p06-cli";
import { captureEventSpool, capturePendingSpool, validateEventSpool } from "../fixtures/w01-spool";
it("joins actual preforward task/workflow spool bytes and retains a report that never reaches the proxy", async () => {
  const server = await launch();
  let f: Awaited<ReturnType<typeof registeredRun>> | undefined,
    closed = false;
  const captured: ReturnType<typeof captureEventSpool>[] = [];
  const proxy = await publicProxy(server, (req, bytes, reply) => {
    if (!reply && req.url?.endsWith("/events") && f) {
      const body = JSON.parse(bytes.toString());
      captured.push(
        captureEventSpool(
          f.env.AGENTFLOW_OUTBOX_DIR,
          {
            kind: body.workflowRunId ? "workflow-run" : "run",
            id: body.workflowRunId ?? body.runId,
          },
          body,
        ),
      );
    }
    return undefined;
  });
  try {
    f = await registeredRun({ ...server, port: proxy.port });
    expect(
      (
        await f.cli([
          "report",
          "--run",
          f.runId,
          "--type",
          "run.started",
          "--payload",
          f.file({}),
        ])
      ).code,
    ).toBe(0);
    const workflowId = randomUUID(),
      revisionId = randomUUID(),
      workflowRunId = randomUUID(),
      nodeId = randomUUID();
    for (const [args, body] of [
      [
        ["register", "workflow"],
        { id: workflowId, projectId: f.projectId, name: "Synthetic spool" },
      ],
      [
        ["register", "workflow-revision", "--workflow", workflowId],
        {
          id: revisionId,
          expectedWorkflowVersion: 1,
          nodes: [{ id: nodeId, label: "Node" }],
          edges: [],
        },
      ],
      [
        ["register", "workflow-run"],
        { id: workflowRunId, workflowId, planRevisionId: revisionId },
      ],
    ] as [string[], unknown][])
      expect(
        (
          await f.cli([
            ...args,
            "--file",
            f.file(body),
            "--idempotency-key",
            randomUUID(),
          ])
        ).code,
      ).toBe(0);
    expect(
      (
        await f.cli([
          "report",
          "--workflow-run",
          workflowRunId,
          "--type",
          "workflow.started",
          "--payload",
          f.file({}),
        ])
      ).code,
    ).toBe(0);
    expect(captured.map((c) => c.producer.kind)).toEqual([
      "run",
      "workflow-run",
    ]);
    for (const value of captured) {
      validateEventSpool(value, value.body);
      expect(
        JSON.parse(Buffer.from(value.originalBytesBase64, "base64").toString())
          .body,
      ).toEqual(value.body);
      expect(value.state?.allocatedThrough).toBe(1);
      expect(value.state?.acknowledgedThrough).toBe(0);
    }
    await proxy.close();
    closed = true;
    const queued = await f.cli([
      "report",
      "--workflow-run",
      workflowRunId,
      "--type",
      "workflow.heartbeat",
      "--payload",
      f.file({}),
    ]);
    expect(queued.code).toBe(2);
    const pending = capturePendingSpool(f.env.AGENTFLOW_OUTBOX_DIR, {
      kind: "workflow-run",
      id: workflowRunId,
    });
    expect(pending).toHaveLength(1);
    expect(pending[0].body?.sequence).toBe(2);
    expect(readFileSync(pending[0].path)).toEqual(
      Buffer.from(pending[0].originalBytesBase64, "base64"),
    );
  } finally {
    if (!closed) await proxy.close();
    await server.stop();
  }
});
