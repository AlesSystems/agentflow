import { randomUUID } from "node:crypto";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { openOwnedStore, migrations } from "../../src/db";
import { launch } from "./server";
export async function legacyWorkflow() {
  const dir = mkdtempSync(
      join(realpathSync(tmpdir()), "agentflow-w01-legacy-ui-"),
    ),
    owned = await openOwnedStore(dir, migrations.slice(0, 2)),
    projectId = randomUUID().toUpperCase(),
    taskId = randomUUID().toUpperCase(),
    agentId = randomUUID().toUpperCase(),
    taskRunId = randomUUID().toUpperCase(),
    db = new Database(join(dir, "agentflow.sqlite"));
  try {
    db.pragma("foreign_keys=ON");
    db.prepare(
      "INSERT INTO projects VALUES(?,'Synthetic legacy workflow',NULL,NULL,1,0,0)",
    ).run(projectId);
    db.prepare(
      "INSERT INTO agents VALUES(?,'Synthetic','legacy','verifier',1,0)",
    ).run(agentId);
    db.prepare(
      "INSERT INTO tasks(id,project_id,title,description,acceptance_criteria,status,priority,tags,version,work_revision,created_at,updated_at) VALUES(?,?,'Synthetic legacy task','','','backlog','normal','[]',1,1,0,0)",
    ).run(taskId, projectId);
    db.prepare(
      "INSERT INTO runs(id,project_id,agent_id,task_id,purpose,work_revision,state,last_sequence,last_received_at,version,created_at) VALUES(?,?,?,?,'verification',1,'queued',0,0,1,0)",
    ).run(taskRunId, projectId, agentId, taskId);
    const foreignKeys = db.pragma("foreign_key_check");
    if (!Array.isArray(foreignKeys) || foreignKeys.length)
      throw new Error("legacy fixture invalid");
  } finally {
    db.close();
    owned.close();
  }
  const server = await launch({ dir });
  try {
    const create = async (path: string, body: unknown) => {
      const reply = await fetch(server.url + "/api/v1" + path, {
          method: "POST",
          headers: {
            Authorization: "Bearer " + server.credentials().reporterToken,
            "Content-Type": "application/json",
            "Idempotency-Key": randomUUID(),
          },
          body: JSON.stringify(body),
        }),
        text = await reply.text();
      if (reply.status !== 201)
        throw new Error(
          "legacy public fixture rejected " + reply.status + " " + text,
        );
      return JSON.parse(text).data;
    };
    const workflowId = randomUUID(),
      revisionId = randomUUID(),
      workflowRunId = randomUUID(),
      nodeId = randomUUID(),
      eventId = randomUUID();
    await create("/workflows", {
      id: workflowId,
      projectId,
      name: "Synthetic legacy references",
    });
    await create(`/workflows/${workflowId}/revisions`, {
      id: revisionId,
      expectedWorkflowVersion: 1,
      nodes: [{ id: nodeId, label: "Legacy linked evidence", taskId }],
      edges: [],
    });
    await create("/workflow-runs", {
      id: workflowRunId,
      workflowId,
      planRevisionId: revisionId,
    });
    await create(`/workflow-runs/${workflowRunId}/events`, {
      schemaVersion: 1,
      eventId: randomUUID(),
      workflowRunId,
      sequence: 1,
      type: "workflow.started",
      occurredAt: new Date().toISOString(),
      payload: {},
    });
    await create(`/workflow-runs/${workflowRunId}/events`, {
      schemaVersion: 1,
      eventId,
      workflowRunId,
      sequence: 2,
      type: "workflow.node.reported",
      occurredAt: new Date().toISOString(),
      payload: { nodeId, runId: taskRunId, state: "running" },
    });
    return {
      server,
      projectId,
      taskId,
      taskRunId,
      workflowId,
      revisionId,
      workflowRunId,
      nodeId,
      eventId,
      url:
        server.url +
        `/projects/${projectId.toLowerCase()}/workflows?workflowId=${workflowId.toUpperCase()}&revisionId=${revisionId.toUpperCase()}&workflowRunId=${workflowRunId.toUpperCase()}&nodeId=${nodeId.toUpperCase()}`,
    };
  } catch (error) {
    await server.stop();
    throw error;
  }
}
