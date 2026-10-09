import { randomUUID } from "node:crypto";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { openOwnedStore, migrations } from "../../src/db";
import { launch, pair } from "../fixtures/server";
it("carries actual legacy identity through related public FK queries writes and paginated histories", async () => {
  const dir = mkdtempSync(
    join(realpathSync(tmpdir()), "agentflow-p04-legacy-roundtrip-"),
  );
  const old = await openOwnedStore(dir, migrations.slice(0, 2));
  old.close();
  const p = "DDDDDDDD-DDDD-4DDD-8DDD-DDDDDDDDDDDD",
    a = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
    t = "EEEEEEEE-EEEE-4EEE-8EEE-EEEEEEEEEEEE";
  const seed = new Database(join(dir, "agentflow.sqlite"));
  seed.pragma("foreign_keys=ON");
  seed
    .prepare(
      "INSERT INTO projects VALUES(?,'Synthetic legacy',NULL,NULL,1,0,0)",
    )
    .run(p);
  seed
    .prepare(
      "INSERT INTO agents VALUES(?,'Synthetic','legacy','implementation',1,0)",
    )
    .run(a);
  seed
    .prepare(
      "INSERT INTO tasks(id,project_id,title,description,acceptance_criteria,status,priority,tags,version,work_revision,created_at,updated_at) VALUES(?,?,'Synthetic legacy','','','review','normal','[]',1,1,0,0)",
    )
    .run(t, p);
  seed.close();
  const server = await launch({ dir });
  try {
    const cookie = await pair(server);
    const call = (
      path: string,
      input?: unknown,
      method = input ? "POST" : "GET",
      human = false,
    ) =>
      fetch(server.url + "/api/v1" + path, {
        method,
        headers: {
          ...(human
            ? { Cookie: cookie, Origin: server.url }
            : {
                Authorization: "Bearer " + server.credentials().reporterToken,
              }),
          "Content-Type": "application/json",
          "Idempotency-Key": randomUUID(),
        },
        ...(input ? { body: JSON.stringify(input) } : {}),
      });
    const comment = await call(`/tasks/${t.toLowerCase()}/comments`, {
      text: "Synthetic first",
    });
    expect(comment.status).toBe(201);
    const first = await comment.json();
    expect(first.data.taskId).toBe(t);
    const list = await call(`/tasks/${t}/comments?limit=1`);
    expect(list.status).toBe(200);
    expect((await list.json()).data).toMatchObject({
      total: 1,
      items: [{ id: first.data.id, taskId: t }],
    });
    const secondResponse = await call(`/tasks/${t}/comments`, {
      text: "Synthetic second",
    });
    expect(secondResponse.status).toBe(201);
    const second = await secondResponse.json();
    const page = await (
      await call(`/tasks/${t.toLowerCase()}/comments?limit=1`)
    ).json();
    expect(page.data.total).toBe(2);
    expect(page.data.nextCursor).not.toBeNull();
    const next = await (
      await call(`/tasks/${t}/comments?limit=1&cursor=${page.data.nextCursor}`)
    ).json();
    expect(
      new Set(
        [...page.data.items, ...next.data.items].map(
          (r: { id: string }) => r.id,
        ),
      ),
    ).toEqual(new Set([first.data.id, second.data.id]));
    const project = await call(
      `/projects/${p.toLowerCase()}`,
      { expectedVersion: 1, name: "Updated synthetic legacy" },
      "PATCH",
    );
    expect(project.status).toBe(200);
    expect((await project.json()).data.id).toBe(p);
    const agent = await call(
      `/agents/${a.toLowerCase()}`,
      { expectedVersion: 1, displayName: "Updated legacy" },
      "PATCH",
    );
    expect(agent.status).toBe(200);
    expect((await agent.json()).data.id).toBe(a);
    const patch = await call(
      `/tasks/${t.toLowerCase()}`,
      { expectedVersion: 1, assignedAgentId: a.toLowerCase() },
      "PATCH",
    );
    expect(patch.status).toBe(200);
    expect((await patch.json()).data).toMatchObject({
      id: t,
      projectId: p,
      assignedAgentId: a,
      version: 2,
    });
    const self = await call(
      `/tasks/${t}`,
      { expectedVersion: 2, parentTaskId: t.toLowerCase() },
      "PATCH",
    );
    expect(self.status).toBe(409);
    expect((await self.json()).error.code).toBe("parent_cycle");
    const complete = await call(
      `/tasks/${t.toLowerCase()}/complete`,
      {
        expectedVersion: 2,
        evidenceNote: "Synthetic browser acceptance fixture",
      },
      "POST",
      true,
    );
    expect(complete.status).toBe(201);
    const accepted = await complete.json();
    expect(accepted.data.taskId).toBe(t);
    const reopen = await call(
      `/tasks/${t}/reopen`,
      { expectedVersion: 3, reason: "Synthetic casing history" },
      "POST",
      true,
    );
    expect(reopen.status).toBe(200);
    expect((await reopen.json()).data).toMatchObject({
      id: t,
      status: "backlog",
      version: 4,
      workRevision: 2,
    });
    const history = await (
      await call(`/tasks/${t.toLowerCase()}?historyLimit=1`)
    ).json();
    expect(history.data.history.completions.items).toEqual([accepted.data]);
    expect(history.data.history.reopens.items[0]).toMatchObject({
      taskId: t,
      workRevision: 2,
    });
    const childResponse = await call("/tasks", {
      projectId: p.toLowerCase(),
      title: "Synthetic child",
      parentTaskId: t.toLowerCase(),
      assignedAgentId: a.toLowerCase(),
    });
    expect(childResponse.status).toBe(201);
    const child = await childResponse.json();
    expect(child.data).toMatchObject({
      projectId: p,
      parentTaskId: t,
      assignedAgentId: a,
    });
    const tasks = await (
      await call(
        `/tasks?projectId=${p.toLowerCase()}&assignedAgentId=${a.toLowerCase()}`,
      )
    ).json();
    expect(tasks.data.total).toBe(2);
    const board = await (
      await call(`/projects/${p.toLowerCase()}/board`)
    ).json();
    expect(
      board.data.columns.find((r: { status: string }) => r.status === "backlog")
        .total,
    ).toBe(2);
    const runId = randomUUID();
    const registration = await call("/runs", {
      id: runId,
      projectId: p.toLowerCase(),
      agentId: a.toLowerCase(),
      taskId: child.data.id.toUpperCase(),
      purpose: "review",
      expectedTaskVersion: 1,
    });
    expect(registration.status).toBe(201);
    const run = await registration.json();
    expect(run.data).toMatchObject({
      projectId: p,
      agentId: a,
      taskId: child.data.id,
    });
    const filtered = await (
      await call(
        `/runs?projectId=${p.toLowerCase()}&agentId=${a.toLowerCase()}&taskId=${child.data.id.toUpperCase()}`,
      )
    ).json();
    expect(filtered.data).toMatchObject({
      total: 1,
      items: [{ id: runId, projectId: p, agentId: a }],
    });
    const db = new Database(join(dir, "agentflow.sqlite"), { readonly: true });
    try {
      expect(
        db
          .prepare(
            "SELECT id,project_id,assigned_agent_id,parent_task_id FROM tasks WHERE id=?",
          )
          .get(t),
      ).toEqual({
        id: t,
        project_id: p,
        assigned_agent_id: a,
        parent_task_id: null,
      });
      expect(db.prepare("SELECT id FROM projects").get()).toEqual({ id: p });
      expect(db.prepare("SELECT id FROM agents").get()).toEqual({ id: a });
      expect(db.prepare("SELECT run_id FROM run_registrations").get()).toEqual({
        run_id: runId,
      });
      expect(
        db.prepare("SELECT last_value FROM run_order_allocator").get(),
      ).toEqual({ last_value: 1 });
      expect(db.pragma("foreign_key_check")).toEqual([]);
    } finally {
      db.close();
    }
  } finally {
    await server.stop();
  }
});
