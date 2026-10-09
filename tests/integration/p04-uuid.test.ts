import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { join } from "node:path";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { launch, pair } from "../fixtures/server";
import { openOwnedStore, migrations } from "../../src/db";
import { canonicalDigest } from "../../src/domain/request-digest";
it("normalizes public input UUIDs while exact retries retain original JSON casing identity", async () => {
  const server = await launch();
  try {
    const cookie = await pair(server);
    const call = (
      path: string,
      input?: unknown,
      key = randomUUID(),
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
          ...(path.endsWith("/events") ? {} : { "Idempotency-Key": key }),
        },
        ...(input ? { body: JSON.stringify(input) } : {}),
      });
    const create = async (path: string, input: unknown) => {
      const response = await call(path, input);
      expect(response.status).toBe(201);
      return (await response.json()).data.id as string;
    };
    const projectId = await create("/projects", {
      name: "Synthetic UUID casing",
    });
    const agentId = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA";
    const agent = await call("/agents", {
      id: agentId,
      displayName: "Synthetic",
      source: "fixture",
      defaultRole: "implementation",
    });
    expect(agent.status).toBe(201);
    expect((await agent.json()).data.id).toBe(agentId.toLowerCase());
    expect((await call("/agents/" + agentId)).status).toBe(200);
    const patch = await call(
      "/agents/" + agentId,
      { expectedVersion: 1, displayName: "Updated" },
      randomUUID(),
      "PATCH",
    );
    expect(patch.status).toBe(200);
    expect((await patch.json()).data.id).toBe(agentId.toLowerCase());
    const taskId = await create("/tasks", {
      projectId: projectId.toUpperCase(),
      title: "Synthetic",
      assignedAgentId: agentId,
    });
    const id = "BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB";
    const registration = {
      id,
      projectId: projectId.toUpperCase(),
      taskId: taskId.toUpperCase(),
      agentId,
      purpose: "implementation",
      expectedTaskVersion: 1,
    };
    const key = randomUUID();
    const first = await call("/runs", registration, key);
    expect(first.status).toBe(201);
    const original = await first.json();
    expect(original.data).toMatchObject({
      id: id.toLowerCase(),
      projectId,
      taskId,
      agentId: agentId.toLowerCase(),
    });
    expect((await call("/runs/" + id)).status).toBe(200);
    expect((await call("/runs?agentId=" + agentId)).status).toBe(200);
    const input = {
      schemaVersion: 1,
      eventId: "CCCCCCCC-CCCC-4CCC-8CCC-CCCCCCCCCCCC",
      runId: id,
      sequence: 1,
      type: "run.started",
      occurredAt: "2026-10-10T00:00:00Z",
      payload: {},
    };
    const accepted = await call(`/runs/${id}/events`, input);
    expect(accepted.status).toBe(201);
    const ack = await accepted.json();
    expect(ack.data).toMatchObject({
      eventId: input.eventId.toLowerCase(),
      runId: id.toLowerCase(),
    });
    const retry = await call(`/runs/${id.toLowerCase()}/events`, input);
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual(ack);
    const changed = await call(`/runs/${id}/events`, {
      ...input,
      eventId: input.eventId.toLowerCase(),
    });
    expect(changed.status).toBe(409);
    expect((await changed.json()).error.code).toBe("idempotency_conflict");
    expect(
      (
        await call(`/runs/${id}/events`, {
          ...input,
          eventId: randomUUID().toUpperCase(),
          runId: id.toLowerCase(),
          sequence: 2,
          type: "run.heartbeat",
        })
      ).status,
    ).toBe(201);
    const db = new Database(join(server.dir, "agentflow.sqlite"));
    try {
      db.prepare("UPDATE runs SET last_received_at=0 WHERE id=?").run(
        id.toLowerCase(),
      );
    } finally {
      db.close();
    }
    const close = { expectedVersion: 3, reason: "Synthetic uppercase close" };
    const closeKey = randomUUID();
    const closed = await call(
      `/runs/${id}/close`,
      close,
      closeKey,
      "POST",
      true,
    );
    expect(closed.status).toBe(200);
    const closeBody = await closed.json();
    const repeated = await call(
      `/runs/${id.toLowerCase()}/close`,
      close,
      closeKey,
      "POST",
      true,
    );
    expect(await repeated.json()).toEqual(closeBody);
    const same = await call("/runs", registration, key);
    expect(same.status).toBe(201);
    expect(await same.json()).toEqual(original);
    const other = await call("/runs", registration);
    expect(other.status).toBe(200);
    expect(await other.json()).toEqual(original);
    const changedRegistration = await call("/runs", {
      ...registration,
      id: id.toLowerCase(),
    });
    expect(changedRegistration.status).toBe(409);
    expect((await changedRegistration.json()).error.code).toBe("run_conflict");
  } finally {
    await server.stop();
  }
});
it("preserves uppercase legacy IDs and rejects casing collisions without rewriting identity or order", async () => {
  const dir = mkdtempSync(
    join(realpathSync(tmpdir()), "agentflow-p04-legacy-case-"),
  );
  const prefix = await openOwnedStore(dir, migrations.slice(0, 2));
  prefix.close();
  const p = "DDDDDDDD-DDDD-4DDD-8DDD-DDDDDDDDDDDD",
    a = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
    r = "BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB";
  const db = new Database(join(dir, "agentflow.sqlite"));
  db.pragma("foreign_keys=ON");
  db.prepare("INSERT INTO projects VALUES(?,'Synthetic',NULL,NULL,1,0,0)").run(
    p,
  );
  db.prepare(
    "INSERT INTO agents VALUES(?,'Synthetic','legacy','implementation',1,0)",
  ).run(a);
  db.prepare(
    "INSERT INTO runs(id,project_id,agent_id,purpose,state,last_sequence,last_received_at,version,created_at) VALUES(?,?,?,'planning','queued',0,0,1,0)",
  ).run(r, p, a);
  const owned = await openOwnedStore(dir);
  try {
    const facts = () =>
      Object.fromEntries(
        [
          "runs",
          "agents",
          "projects",
          "run_order_allocator",
          "run_registrations",
          "run_events",
          "run_closures",
          "receipts",
          "changes",
        ].map((t) => [t, db.prepare(`SELECT * FROM ${t}`).all()]),
      );
    const before = facts();
    expect(
      owned.store.snapshot({ kind: "run", id: r.toLowerCase() }, 1000).body
        .data,
    ).toMatchObject({ id: r, projectId: p, agentId: a });
    const input = {
      id: r.toLowerCase(),
      projectId: p.toLowerCase(),
      agentId: a.toLowerCase(),
      purpose: "planning" as const,
    };
    expect(() =>
      owned.store.command(
        { kind: "run.register", input },
        {
          principal: "reporter",
          method: "POST",
          path: "/api/v1/runs",
          key: randomUUID(),
          digest: canonicalDigest(input),
          now: 1000,
        },
      ),
    ).toThrow("run_conflict");
    expect(facts()).toEqual(before);
    const event = {
      schemaVersion: 1 as const,
      eventId: randomUUID(),
      runId: r.toLowerCase(),
      sequence: 1,
      type: "run.started" as const,
      occurredAt: "2026-10-10T00:00:00.000Z",
      payload: {},
    };
    expect(
      owned.store.command(
        { kind: "run.event", id: r.toLowerCase(), input: event },
        {
          principal: "reporter",
          method: "POST",
          path: `/api/v1/runs/${r.toLowerCase()}/events`,
          key: "",
          digest: canonicalDigest(event),
          now: 1000,
        },
      ).status,
    ).toBe(201);
    expect(
      db
        .prepare("SELECT id,project_id,agent_id,registration_order FROM runs")
        .get(),
    ).toEqual({ id: r, project_id: p, agent_id: a, registration_order: 1 });
    expect(
      (
        owned.store.snapshot(
          { kind: "events", id: r.toLowerCase(), input: { limit: 50 } },
          1000,
        ).body.data as { total: number }
      ).total,
    ).toBe(1);
    const close = { expectedVersion: 2, reason: "Synthetic legacy close" };
    expect(
      owned.store.command(
        { kind: "run.close", id: r.toLowerCase(), input: close },
        {
          principal: "operator",
          method: "POST",
          path: `/api/v1/runs/${r.toLowerCase()}/close`,
          key: randomUUID(),
          digest: canonicalDigest(close),
          now: 61001,
        },
      ).status,
    ).toBe(200);
    db.prepare(
      "INSERT INTO agents VALUES(?,'Other','legacy','implementation',1,0)",
    ).run(a.toLowerCase());
    const ambiguous = facts();
    expect(() =>
      owned.store.snapshot({ kind: "agent", id: a.toLowerCase() }, 1000),
    ).toThrow("identity_ambiguous");
    expect(facts()).toEqual(ambiguous);
  } finally {
    db.close();
    owned.close();
  }
});
