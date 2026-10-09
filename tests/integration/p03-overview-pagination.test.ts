import { it, expect } from "vitest";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { openOwnedStore } from "../../src/db";
import { canonicalDigest } from "../../src/domain/request-digest";
import type { ApplicationCommand } from "../../src/db/application";
import { overviewResponse } from "../../src/contracts/responses";
import { seedRun } from "../fixtures/application";
import { launch } from "../fixtures/server";
it.each(["blocked", "failed", "mixed"] as const)(
  "HTTP Overview %s continuation is disjoint and terminates with stable totals",
  async (mode) => {
    const dir = mkdtempSync(
      join(realpathSync(tmpdir()), "agentflow-overview-cursor-"),
    );
    const owned = await openOwnedStore(dir);
    let now = Date.now();
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
      send({ kind: "project.create", input: { name: "Synthetic pagination" } })
        .body.data as { id: string }
    ).id;
    const ids: string[] = [];
    try {
      for (let i = 0; i < 51; i++) {
        const kind =
          mode === "mixed" ? ["blocked", "failed", "stale"][i % 3] : mode;
        const task = send({
          kind: "task.create",
          input: {
            projectId,
            title: `Synthetic ${kind} ${i}`,
            blockedReason: kind === "blocked" ? "Synthetic blocker" : null,
          },
        }).body.data as { id: string };
        ids.push(task.id);
        if (kind !== "blocked")
          seedRun(owned.instance, {
            projectId,
            taskId: task.id,
            state: kind === "failed" ? "failed" : "running",
            createdAt: now++,
            receivedAt: kind === "failed" ? now : now - 90000,
            endedAt: kind === "failed" ? now : undefined,
          });
      }
    } finally {
      owned.close();
    }
    const server = await launch({ dir });
    try {
      async function read(cursor?: string) {
        const response = await fetch(
          server.url +
            "/api/v1/overview?limit=50" +
            (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
          {
            headers: {
              Authorization: "Bearer " + server.credentials().reporterToken,
            },
          },
        );
        expect(response.status).toBe(200);
        return overviewResponse.parse(await response.json()).data.attention;
      }
      const first = await read();
      expect(first.total).toBe(51);
      expect(first.items).toHaveLength(50);
      expect(first.nextCursor).not.toBeNull();
      const second = await read(first.nextCursor!);
      expect(second.total).toBe(51);
      expect(second.items).toHaveLength(1);
      expect(second.nextCursor).toBeNull();
      expect(
        new Set([...first.items, ...second.items].map((item) => item.id)),
      ).toEqual(new Set(ids));
      expect(
        second.items.every(
          (item) => !first.items.some((old) => old.id === item.id),
        ),
      ).toBe(true);
    } finally {
      await server.stop();
    }
  },
);
