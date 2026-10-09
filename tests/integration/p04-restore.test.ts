import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { join } from "node:path";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { openOwnedStore } from "../../src/db";
import { restore } from "../../src/db/recovery";
import { canonicalDigest } from "../../src/domain/request-digest";
import type { ApplicationCommand } from "../../src/db/application";
it("restores retained registration/event/close receipts but does not deduplicate discarded history", async () => {
  const dir = mkdtempSync(
    join(realpathSync(tmpdir()), "agentflow-p04-restore-"),
  );
  let owned = await openOwnedStore(dir);
  const send = (
    command: ApplicationCommand,
    now = 1000,
    key = randomUUID(),
    principal: "operator" | "reporter" = "reporter",
  ) =>
    owned.store.command(command, {
      principal,
      method: "POST",
      path:
        command.kind === "run.close"
          ? `/api/v1/runs/${command.id}/close`
          : command.kind,
      key,
      digest: canonicalDigest(command.input),
      now,
    });
  try {
    const projectId = (
      send({ kind: "project.create", input: { name: "Synthetic restore" } })
        .body.data as { id: string }
    ).id;
    const agentId = (
      send({
        kind: "agent.create",
        input: {
          displayName: "Synthetic",
          source: "fixture",
          defaultRole: "implementation",
        },
      }).body.data as { id: string }
    ).id;
    const input = {
      id: randomUUID(),
      projectId,
      agentId,
      purpose: "planning" as const,
    };
    const registration = send({ kind: "run.register", input });
    const event = {
      schemaVersion: 1 as const,
      eventId: randomUUID(),
      runId: input.id,
      sequence: 1,
      type: "run.started" as const,
      occurredAt: "2026-10-10T00:00:00.000Z",
      payload: {},
    };
    const ack = send({ kind: "run.event", id: input.id, input: event }, 2000);
    const close: ApplicationCommand = {
      kind: "run.close",
      id: input.id,
      input: { expectedVersion: 2, reason: "Synthetic retained close" },
    };
    const key = randomUUID();
    const closed = send(close, 62001, key, "operator");
    const generation = owned.store.metadata().generation;
    owned.store.createSession("synthetic", 0, 9999999999999);
    const backup = join(dir, "backups", "retained.sqlite");
    await owned.store.backup(backup);
    const lostInput = { ...input, id: randomUUID() };
    send({ kind: "run.register", input: lostInput }, 70000);
    const lostEvent = { ...event, eventId: randomUUID(), runId: lostInput.id };
    send({ kind: "run.event", id: lostInput.id, input: lostEvent }, 71000);
    owned.close();
    await restore(dir, backup);
    owned = await openOwnedStore(dir);
    expect(owned.store.metadata().generation).not.toBe(generation);
    expect(owned.store.sessionCount()).toBe(0);
    const db = new Database(join(dir, "agentflow.sqlite"), { readonly: true });
    try {
      const facts = () =>
        Object.fromEntries(
          [
            "runs",
            "run_events",
            "run_registrations",
            "run_closures",
            "receipts",
            "changes",
            "run_order_allocator",
          ].map((t) => [t, db.prepare(`SELECT * FROM ${t}`).all()]),
        );
      const before = facts();
      expect(send({ kind: "run.register", input }, 999999)).toEqual({
        ...registration,
        status: 200,
      });
      const afterRegistration = facts();
      expect(afterRegistration.runs).toEqual(before.runs);
      expect(afterRegistration.changes).toEqual(before.changes);
      expect(
        send({ kind: "run.event", id: input.id, input: event }, 999999),
      ).toEqual({ ...ack, status: 200 });
      expect(send(close, 999999, key, "operator")).toEqual(closed);
      expect(facts()).toEqual(afterRegistration);
      expect(() =>
        send({ kind: "run.event", id: lostInput.id, input: lostEvent }, 999999),
      ).toThrow("resource_not_found");
      expect(facts()).toEqual(afterRegistration);
      expect(
        db.prepare("SELECT last_value FROM run_order_allocator").get(),
      ).toEqual({ last_value: 1 });
      expect(
        db.prepare("SELECT count(*) n FROM run_registrations").get(),
      ).toEqual({ n: 1 });
      expect(db.prepare("SELECT count(*) n FROM run_events").get()).toEqual({
        n: 1,
      });
      expect(
        send({ kind: "run.register", input: lostInput }, 1000000).status,
      ).toBe(201);
      expect(
        db
          .prepare("SELECT registration_order FROM runs WHERE id=?")
          .get(lostInput.id),
      ).toEqual({ registration_order: 2 });
    } finally {
      db.close();
    }
  } finally {
    owned.close();
  }
});
it("returns retained HTTP retry bodies with the renewed generation header after stopped restore", async () => {
  const { launch, pair } = await import("../fixtures/server");
  let server = await launch();
  try {
    let cookie = await pair(server);
    const call = (
      path: string,
      input: unknown,
      key = randomUUID(),
      human = false,
    ) =>
      fetch(server.url + "/api/v1" + path, {
        method: "POST",
        headers: {
          ...(human
            ? { Cookie: cookie, Origin: server.url }
            : {
                Authorization: "Bearer " + server.credentials().reporterToken,
              }),
          "Content-Type": "application/json",
          ...(path.endsWith("/events") ? {} : { "Idempotency-Key": key }),
        },
        body: JSON.stringify(input),
      });
    const create = async (path: string, input: unknown) => {
      const response = await call(path, input);
      expect(response.status).toBe(201);
      return (await response.json()).data.id as string;
    };
    const projectId = await create("/projects", {
      name: "Synthetic HTTP restore",
    });
    const agentId = await create("/agents", {
      displayName: "Synthetic",
      source: "fixture",
      defaultRole: "implementation",
    });
    const id = randomUUID();
    const registration = { id, projectId, agentId, purpose: "planning" };
    const registrationKey = randomUUID();
    const first = await call("/runs", registration, registrationKey);
    const registrationBody = await first.json();
    const generation = first.headers.get("AgentFlow-Generation");
    const event = {
      schemaVersion: 1,
      eventId: randomUUID(),
      runId: id,
      sequence: 1,
      type: "run.started",
      occurredAt: "2099-01-01T00:00:00Z",
      payload: {},
    };
    const observed = await call(`/runs/${id}/events`, event);
    const eventBody = await observed.json();
    const age = new Database(join(server.dir, "agentflow.sqlite"));
    age.prepare("UPDATE runs SET last_received_at=0 WHERE id=?").run(id);
    age.close();
    const close = {
      expectedVersion: 2,
      reason: "Synthetic stopped-restore audit",
    };
    const closeKey = randomUUID();
    const closed = await call(`/runs/${id}/close`, close, closeKey, true);
    expect(closed.status).toBe(200);
    const closeBody = await closed.json();
    const dir = server.dir;
    await server.stop();
    const backup = join(dir, "backups", "http-retained.sqlite");
    const owned = await openOwnedStore(dir);
    await owned.store.backup(backup);
    owned.close();
    server = await launch({ dir });
    cookie = await pair(server);
    const lostId = randomUUID();
    expect((await call("/runs", { ...registration, id: lostId })).status).toBe(
      201,
    );
    await server.stop();
    await restore(dir, backup);
    server = await launch({ dir });
    cookie = await pair(server);
    for (const [path, input, key, human, expected, status] of [
      ["/runs", registration, registrationKey, false, registrationBody, 201],
      [`/runs/${id}/events`, event, randomUUID(), false, eventBody, 200],
      [`/runs/${id}/close`, close, closeKey, true, closeBody, 200],
    ] as const) {
      const response = await call(path, input, key, human);
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual(expected);
      expect(response.headers.get("AgentFlow-Generation")).not.toBe(generation);
    }
    const missing = await call(`/runs/${lostId}/events`, {
      ...event,
      eventId: randomUUID(),
      runId: lostId,
    });
    expect(missing.status).toBe(404);
  } finally {
    await server.stop();
  }
});
