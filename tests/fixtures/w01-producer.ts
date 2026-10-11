import { randomUUID } from "node:crypto";
import { cliFixture } from "./p06-cli";
import type { launch } from "./server";
export async function reportedWorkflow(
  server: Awaited<ReturnType<typeof launch>>,
) {
  const f = cliFixture(server);
  const register = async (args: string[], body: unknown) => {
    const result = await f.cli([
      ...args,
      "--file",
      f.file(body),
      "--idempotency-key",
      randomUUID(),
    ]);
    if (result.code !== 0)
      throw new Error(
        "synthetic workflow registration failed " + result.stderr,
      );
    return JSON.parse(result.stdout).id as string;
  };
  const reportTask = async (id: string, type: string, payload: unknown) => {
    const result = await f.cli([
      "report",
      "--run",
      id,
      "--type",
      type,
      "--payload",
      f.file(payload),
    ]);
    if (result.code !== 0)
      throw new Error("synthetic task report failed " + result.stderr);
    return JSON.parse(result.stdout);
  };
  const projectId = await register(["project", "create"], {
      name: "Synthetic workflow project",
    }),
    agentId = await register(["agent", "register"], {
      displayName: "Synthetic workflow producer",
      source: "public CLI",
      defaultRole: "implementation",
    }),
    taskId = await register(["task", "create"], {
      projectId,
      title: "Synthetic linked work",
    });
  const implementationRunId = await register(["run", "register"], {
    id: randomUUID(),
    projectId,
    agentId,
    taskId,
    purpose: "implementation",
    expectedTaskVersion: 1,
  });
  await reportTask(implementationRunId, "run.started", {});
  await reportTask(implementationRunId, "run.succeeded", {
    summary: "Synthetic implementation evidence",
  });
  const verificationRunId = await register(["run", "register"], {
    id: randomUUID(),
    projectId,
    agentId,
    taskId,
    purpose: "verification",
    expectedTaskVersion: 4,
  });
  await reportTask(verificationRunId, "run.started", {});
  const workflowId = await register(["register", "workflow"], {
      id: randomUUID(),
      projectId,
      name: "Ship the reported change",
    }),
    implementationNodeId = randomUUID(),
    verificationNodeId = randomUUID(),
    unknownNodeId = randomUUID();
  const nodes = [
    { id: implementationNodeId, label: "Build the change", taskId },
    { id: verificationNodeId, label: "Verify the change", taskId },
    { id: unknownNodeId, label: "Unreported follow-up" },
  ];
  const revisionId = await register(
    ["register", "workflow-revision", "--workflow", workflowId],
    {
      id: randomUUID(),
      expectedWorkflowVersion: 1,
      nodes,
      edges: [
        { source: implementationNodeId, target: verificationNodeId },
        { source: implementationNodeId, target: unknownNodeId },
      ],
    },
  );
  const workflowRunId = await register(["register", "workflow-run"], {
    id: randomUUID(),
    workflowId,
    planRevisionId: revisionId,
  });
  const report = async (type: string, payload: unknown) => {
    const result = await f.cli([
      "report",
      "--workflow-run",
      workflowRunId,
      "--type",
      type,
      "--payload",
      f.file(payload),
    ]);
    if (result.code !== 0)
      throw new Error("synthetic workflow report failed " + result.stderr);
    return JSON.parse(result.stdout);
  };
  await report("workflow.started", {});
  const implementationReport = await report("workflow.node.reported", {
      nodeId: implementationNodeId,
      runId: implementationRunId,
      state: "succeeded",
      reportedSkill: {
        name: "Test-driven development",
        source: "synthetic://inert-skill",
        version: "1",
      },
    }),
    verificationReport = await report("workflow.node.reported", {
      nodeId: verificationNodeId,
      runId: verificationRunId,
      state: "running",
    });
  return {
    ...f,
    projectId,
    taskId,
    agentId,
    workflowId,
    revisionId,
    workflowRunId,
    implementationNodeId,
    verificationNodeId,
    unknownNodeId,
    implementationRunId,
    verificationRunId,
    implementationReport,
    verificationReport,
    nodes,
    report,
    register,
    url:
      server.url +
      `/projects/${projectId}/workflows?workflowId=${workflowId}&revisionId=${revisionId}&workflowRunId=${workflowRunId}&nodeId=${verificationNodeId}`,
  };
}
