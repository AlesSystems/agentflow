import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { openOwnedStore } from "../../src/db";
import { canonicalDigest } from "../../src/domain/request-digest";
import type { ApplicationCommand } from "../../src/db/application";
it("bounds stable lists and retrieves every immutable acceptance and reopen exactly once", async () => {
  const owned = await openOwnedStore(
    mkdtempSync(join(realpathSync(tmpdir()), "agentflow-pages-")),
  );
  try {
    let now = 1000;
    const send = (command: ApplicationCommand) =>
      owned.store.command(command, {
        principal: "operator",
        method: "POST",
        path: command.kind,
        key: randomUUID(),
        digest: canonicalDigest(command),
        now: now++,
      });
    const projectId = (
      send({ kind: "project.create", input: { name: "Synthetic" } }).body
        .data as { id: string }
    ).id;
    for (let i = 0; i < 105; i++)
      send({ kind: "task.create", input: { projectId, title: `task ${i}` } });
    const page = owned.store.snapshot(
      { kind: "tasks", input: { projectId, limit: 50 } },
      now,
    ).body;
    const list = page.data as {
      items: { id: string }[];
      nextCursor: string;
      total: number;
    };
    expect(list.items).toHaveLength(50);
    expect(list.total).toBe(105);
    expect(list.nextCursor).toBeTypeOf("string");
    const next = owned.store.snapshot(
      {
        kind: "tasks",
        input: { projectId, limit: 50, cursor: list.nextCursor },
      },
      now,
    ).body.data as typeof list;
    expect(next.items).toHaveLength(50);
    expect(new Set([...list.items, ...next.items].map((t) => t.id)).size).toBe(
      100,
    );
    expect(() =>
      owned.store.snapshot(
        {
          kind: "tasks",
          input: { projectId, limit: 49, cursor: list.nextCursor },
        },
        now,
      ),
    ).toThrow("cursor_invalid");
    const id = list.items[0].id;
    let version = 1;
    for (let i = 0; i < 55; i++) {
      send({
        kind: "task.patch",
        id,
        input: { expectedVersion: version++, status: "review" },
      });
      send({
        kind: "task.complete",
        id,
        input: {
          expectedVersion: version++,
          evidenceNote: "Synthetic acceptance",
        },
      });
      send({
        kind: "task.reopen",
        id,
        input: { expectedVersion: version++, reason: "Synthetic rework" },
      });
    }
    for (const history of ["completion", "reopen"] as const) {
      let cursor: string | undefined;
      const ids: string[] = [];
      do {
        const data = owned.store.snapshot(
          {
            kind: "task",
            id,
            input: {
              history,
              historyLimit: 50,
              ...(history === "completion"
                ? { completionCursor: cursor }
                : { reopenCursor: cursor }),
            },
          },
          now,
        ).body.data as {
          history: {
            completions: {
              items: { id: string }[];
              nextCursor: string | null;
              nextUrl: string | null;
            } | null;
            reopens: {
              items: { id: string }[];
              nextCursor: string | null;
              nextUrl: string | null;
            } | null;
          };
        };
        const result =
          history === "completion"
            ? data.history.completions!
            : data.history.reopens!;
        ids.push(...result.items.map((f) => f.id));
        expect(
          history === "completion"
            ? data.history.reopens
            : data.history.completions,
        ).toBeNull();
        if (result.nextCursor)
          expect(result.nextUrl).toContain("history=" + history);
        cursor = result.nextCursor ?? undefined;
      } while (cursor);
      expect(ids).toHaveLength(55);
      expect(new Set(ids).size).toBe(55);
    }
    const board = owned.store.snapshot(
      { kind: "board", id: projectId, input: { limit: 50 } },
      now,
    ).body.data as {
      columns: { status: string; total: number; items: unknown[] }[];
    };
    expect(board.columns).toHaveLength(4);
    expect(board.columns.reduce((n, c) => n + c.total, 0)).toBe(105);
  } finally {
    owned.close();
  }
});
it("counts local-day current acceptance, distinct reports, exact freshness and grouped attention", async () => {
  const { seedRun } = await import("../fixtures/application");
  const owned = await openOwnedStore(
    mkdtempSync(join(realpathSync(tmpdir()), "agentflow-metrics-")),
  );
  try {
    const now = Date.parse("2026-11-01T06:00:00Z");
    const send = (command: ApplicationCommand, at = now) =>
      owned.store.command(command, {
        principal: "operator",
        method: "POST",
        path: command.kind,
        key: randomUUID(),
        digest: canonicalDigest(command),
        now: at,
      });
    const p = (
      send({ kind: "project.create", input: { name: "active" } }).body.data as {
        id: string;
      }
    ).id;
    const archive = (
      send({ kind: "project.create", input: { name: "archive" } }).body
        .data as { id: string }
    ).id;
    const make = (projectId: string, title: string, blockedReason?: string) =>
      (
        send({
          kind: "task.create",
          input: { projectId, title, blockedReason },
        }).body.data as { id: string }
      ).id;
    const accepted = make(p, "accepted");
    send({
      kind: "task.patch",
      id: accepted,
      input: { expectedVersion: 1, status: "review" },
    });
    send(
      {
        kind: "task.complete",
        id: accepted,
        input: { expectedVersion: 2, evidenceNote: "Synthetic acceptance" },
      },
      Date.parse("2026-11-01T04:00Z"),
    );
    const obsolete = make(p, "reopened");
    send({
      kind: "task.patch",
      id: obsolete,
      input: { expectedVersion: 1, status: "review" },
    });
    send({
      kind: "task.complete",
      id: obsolete,
      input: { expectedVersion: 2, evidenceNote: "Synthetic acceptance" },
    });
    send({
      kind: "task.reopen",
      id: obsolete,
      input: { expectedVersion: 3, reason: "Synthetic rework" },
    });
    const blocked = make(p, "blocked", "dependency");
    const review = make(p, "review");
    send({
      kind: "task.patch",
      id: review,
      input: { expectedVersion: 1, status: "review" },
    });
    const live = seedRun(owned.instance, {
      projectId: p,
      taskId: blocked,
      state: "running",
      receivedAt: now - 60000,
    });
    seedRun(owned.instance, {
      projectId: p,
      state: "running",
      receivedAt: now - 60000,
      agentId: live.agentId,
    });
    seedRun(owned.instance, {
      projectId: p,
      state: "queued",
      receivedAt: now - 60001,
    });
    seedRun(owned.instance, {
      projectId: p,
      taskId: blocked,
      state: "failed",
      receivedAt: now,
      endedAt: Date.parse("2026-11-02T05:00Z"),
    });
    seedRun(owned.instance, {
      projectId: p,
      taskId: blocked,
      state: "failed",
      receivedAt: now,
      endedAt: Date.parse("2026-11-01T04:00Z"),
    });
    seedRun(owned.instance, {
      projectId: archive,
      state: "failed",
      endedAt: now,
    });
    send({
      kind: "project.patch",
      id: archive,
      input: { expectedVersion: 1, archived: true },
    });
    const data = owned.store.snapshot(
      { kind: "overview", input: { timezone: "America/New_York", limit: 50 } },
      now,
    ).body.data as {
      metrics: unknown;
      attention: {
        items: { taskId: string | null; reasons: string[] }[];
        total: number;
      };
      day: unknown;
    };
    expect(data.metrics).toEqual({
      activeProjects: 1,
      reportingAgents: 1,
      completedToday: 1,
      awaitingReview: 1,
      failedRunsToday: 1,
    });
    expect(data.day).toEqual({
      start: "2026-11-01T04:00:00.000Z",
      end: "2026-11-02T05:00:00.000Z",
    });
    expect(data.attention.total).toBe(2);
    expect(
      data.attention.items.find((i) => i.taskId === blocked)?.reasons,
    ).toEqual(["blocked", "failed"]);
  } finally {
    owned.close();
  }
});
it("binds task and history cursors to kind, filters, generation and board continuations", async () => {
  const owned = await openOwnedStore(
    mkdtempSync(join(realpathSync(tmpdir()), "agentflow-binding-")),
  );
  try {
    let now = 1000;
    const send = (command: ApplicationCommand) =>
      owned.store.command(command, {
        principal: "operator",
        method: "POST",
        path: command.kind,
        key: randomUUID(),
        digest: canonicalDigest(command),
        now: now++,
      });
    const projectId = (
      send({ kind: "project.create", input: { name: "Synthetic cursor" } }).body
        .data as { id: string }
    ).id;
    const ids: string[] = [];
    for (let i = 0; i < 3; i++)
      ids.push(
        (
          send({
            kind: "task.create",
            input: { projectId, title: "task " + i, tags: ["fixture"] },
          }).body.data as { id: string }
        ).id,
      );
    const board = owned.store.snapshot(
      { kind: "board", id: projectId, input: { limit: 1, tag: "fixture" } },
      now,
    ).body.data as { columns: { status: string; nextCursor: string | null }[] };
    const cursor = board.columns.find(
      (c) => c.status === "backlog",
    )!.nextCursor!;
    expect(
      (
        owned.store.snapshot(
          {
            kind: "tasks",
            input: {
              projectId,
              status: "backlog",
              tag: "fixture",
              limit: 1,
              cursor,
            },
          },
          now,
        ).body.data as { items: unknown[] }
      ).items,
    ).toHaveLength(1);
    expect(() =>
      owned.store.snapshot(
        {
          kind: "tasks",
          input: {
            projectId,
            status: "review",
            tag: "fixture",
            limit: 1,
            cursor,
          },
        },
        now,
      ),
    ).toThrow("cursor_invalid");
    for (let i = 0; i < 2; i++) {
      send({
        kind: "task.patch",
        id: ids[0],
        input: { expectedVersion: 1 + i * 3, status: "review" },
      });
      send({
        kind: "task.complete",
        id: ids[0],
        input: {
          expectedVersion: 2 + i * 3,
          evidenceNote: "Synthetic acceptance",
        },
      });
      send({
        kind: "task.reopen",
        id: ids[0],
        input: { expectedVersion: 3 + i * 3, reason: "Synthetic rework" },
      });
    }
    const detail = owned.store.snapshot(
      { kind: "task", id: ids[0], input: { history: "both", historyLimit: 1 } },
      now,
    ).body.data as {
      history: {
        completions: { nextCursor: string };
        reopens: { nextCursor: string };
      };
    };
    const completionCursor = detail.history.completions.nextCursor;
    expect(() =>
      owned.store.snapshot(
        {
          kind: "task",
          id: ids[1],
          input: { history: "completion", historyLimit: 1, completionCursor },
        },
        now,
      ),
    ).toThrow("cursor_invalid");
    expect(() =>
      owned.store.snapshot(
        {
          kind: "task",
          id: ids[0],
          input: {
            history: "reopen",
            historyLimit: 1,
            reopenCursor: completionCursor,
          },
        },
        now,
      ),
    ).toThrow("cursor_invalid");
    owned.store.renewGeneration();
    expect(() =>
      owned.store.snapshot(
        {
          kind: "task",
          id: ids[0],
          input: { history: "completion", historyLimit: 1, completionCursor },
        },
        now,
      ),
    ).toThrow("cursor_invalid");
  } finally {
    owned.close();
  }
});
