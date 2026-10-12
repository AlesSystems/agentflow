import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { publicProxy, type Reply } from "../fixtures/p06-proxy";
import { reportedUsage, usageCliFixture } from "../fixtures/w03c-cli";
import { pair } from "../fixtures/server";
import { usageMeasurement } from "../../src/contracts/usage";
import { historyLine } from "../../src/contracts/history";
import { canonicalDigest } from "../../src/domain/request-digest";

type Fixture = Awaited<ReturnType<typeof usageCliFixture>>;
async function report(f: Fixture, type: string, payload: unknown, code = 0, id = f.runId, port = f.port) {
  const result = await f.command(["report", "--run", id, "--type", type, "--payload", f.file(payload)], false, port);
  expect(result.code, result.stderr).toBe(code); return result;
}
async function flush(f: Fixture, code = 0, id = f.runId, port = f.port) {
  const result = await f.command(["flush", "--run", id], false, port);
  expect(result.code, result.stderr).toBe(code); return result;
}
it("real_cli_usage_replays_without_double_count", async () => {
  const f = await usageCliFixture("downtime");
  try {
    await report(f, "run.started", {});
    await f.stop();
    await report(f, "run.usage", reportedUsage("partial", null, 7), 2);
    await report(f, "run.usage", reportedUsage("complete"), 2);
    const pending = f.pending(), state = f.state();
    expect(pending).toHaveLength(2); expect(JSON.parse(state.toString())).toMatchObject({ allocatedThrough: 3, acknowledgedThrough: 1 });
    await f.start(); expect(f.pending().map(p => p.bytes)).toEqual(pending.map(p => p.bytes));
    const ack = (await flush(f)).stdout.trim().split("\n").map(row => JSON.parse(row));
    expect(ack.map(a => a.acceptedSequence)).toEqual([2, 3]);
    expect(ack.map(a => a.eventId)).toEqual(pending.map(p => JSON.parse(p.bytes.toString()).body.eventId));
    expect(JSON.parse(f.state().toString())).toMatchObject({ allocatedThrough: 3, acknowledgedThrough: 3 }); expect(f.pending()).toEqual([]);
    const summary = await f.summary(); expect(summary.data).toMatchObject({ eligibleRuns: 1, runsWithReports: 1, runsWithoutReports: 0, filteredReportCount: 2, knownInputTokens: "3", knownOutputTokens: "14", knownTotalTokens: "10", unknownInputReports: 1, unknownOutputReports: 0, unknownTotalReports: 1 });
    expect(summary.data.runDetails[0]).toMatchObject({ runId: f.runId, purpose: "implementation", matchingReportCount: 2, firstMeasuredAt: "2026-01-01T00:00:00.000Z" });
    const stateAfter = f.state(); await flush(f); expect(f.state()).toEqual(stateAfter);
    await f.stop(); const facts = f.copiedSql("delivered"); expect(facts.usage).toHaveLength(2); expect(facts.events).toHaveLength(3);
    for (const p of pending) { const record = JSON.parse(p.bytes.toString()); expect(facts.events.find(e => e.event_id === record.body.eventId)).toMatchObject({ digest: canonicalDigest(record.body), sequence: record.body.sequence }); }
  } finally { await f.finish(); }
}, 60000);
it("lost_ack_and_fresh_envelope_have_distinct_identities", async () => {
  const wires: { body: string; reply: Reply }[] = []; let drop = true; let proxy: Awaited<ReturnType<typeof publicProxy>>;
  const f = await usageCliFixture("lost-ack", async server => { proxy = await publicProxy(server, (req, body, reply) => { if (req.url?.endsWith("/events") && JSON.parse(body.toString()).type === "run.usage" && reply) { wires.push({ body: body.toString(), reply }); if (drop) return { drop: true }; } }, { httpMs: 5000, closeMs: 5000 }); return proxy!.port; });
  try {
    await report(f, "run.started", {});
    const payload = reportedUsage("once"); await report(f, "run.usage", payload, 2, f.runId, proxy!.port);
    const pending = f.pending()[0], original = JSON.parse(pending.bytes.toString());
    expect(JSON.parse(f.state().toString())).toMatchObject({ allocatedThrough: 2, acknowledgedThrough: 1 }); expect(wires[0].reply.status).toBe(201);
    expect((await f.summary()).data.filteredReportCount).toBe(1);
    drop = false; const ack = JSON.parse((await flush(f, 0, f.runId, proxy!.port)).stdout);
    expect(ack).toMatchObject({ eventId: original.body.eventId, acceptedSequence: 2 });
    for (const wire of wires) { expect(wire.body).toBe(JSON.stringify(original.body)); expect(wire.reply.body).toEqual(wires[0].reply.body); }
    const fresh = JSON.parse((await report(f, "run.usage", payload)).stdout); expect(fresh.acceptedSequence).toBe(3); expect(fresh.eventId).not.toBe(ack.eventId);
    expect((await f.summary()).data).toMatchObject({ filteredReportCount: 1, knownTotalTokens: "10" });
    const receivedAt = JSON.parse(wires[0].reply.body.toString()).data.receivedAt;
    const laterFrom = new Date(Date.parse(receivedAt) + 1).toISOString(), laterTo = new Date(Date.now() + 86400000).toISOString();
    expect((await f.request(`/usage?projectId=${f.projectId}&from=${laterFrom}&to=${laterTo}`)).body.data).toMatchObject({ filteredReportCount: 0, knownTotalTokens: "0", eligibleRuns: 1, runsWithoutReports: 1 });
    await f.stop(); const facts = f.copiedSql("deduplicated"); expect(facts.usage).toHaveLength(1); expect(facts.events.filter(e => e.type === "run.usage")).toHaveLength(2);
    expect(facts.usage[0]).toMatchObject({ event_id: ack.eventId, usage_id: "once", first_received_at: Date.parse(receivedAt) });
    for (const event of facts.events.filter(e => e.type === "run.usage")) expect(JSON.parse(event.acknowledgement).data).toMatchObject({ eventId: event.event_id, acceptedSequence: event.sequence });
  } finally { await proxy!.close(); await f.finish({ wires }); }
}, 60000);
it("changed_usage_blocks_delivery_without_advancing", async () => {
  const f = await usageCliFixture("conflict");
  try {
    await report(f, "run.started", {}); await report(f, "run.usage", reportedUsage("stable"));
    await f.stop(); const before = f.copiedSql("before-conflict"); await f.start();
    const rejected = await report(f, "run.usage", reportedUsage("stable", 4, 7), 3); expect(rejected.stderr).toContain("usage_conflict");
    const pending = f.pending(), state = f.state(); expect(pending).toHaveLength(1); expect(JSON.parse(state.toString())).toMatchObject({ allocatedThrough: 3, acknowledgedThrough: 2 });
    const rejectedBody = JSON.parse(pending[0].bytes.toString()).body;
    const conflict = await f.request(`/runs/${f.runId}/events`, rejectedBody); expect(conflict.status).toBe(409); expect(conflict.body.error.code).toBe("usage_conflict");
    const retry = await flush(f, 3); expect(retry.stderr).toContain("usage_conflict"); expect(f.state()).toEqual(state); expect(f.pending()[0].bytes).toEqual(pending[0].bytes);
    await report(f, "run.usage", reportedUsage("later"), 3); expect(f.pending()).toHaveLength(2); expect(f.pending()[0].bytes).toEqual(pending[0].bytes);
    expect(JSON.parse(f.state().toString())).toMatchObject({ allocatedThrough: 4, acknowledgedThrough: 2 });
    expect((await f.summary()).data).toMatchObject({ filteredReportCount: 1, knownTotalTokens: "10" });
    await f.stop(); const after = f.copiedSql("blocked"); expect(after.events).toEqual(before.events); expect(after.usage).toEqual(before.usage); expect(after.runs).toEqual(before.runs);
  } finally { await f.finish(); }
}, 60000);
it("restore_prefix_loss_preserves_outbox", async () => {
  for (const scenario of ["retained", "missing"] as const) {
    let drop = scenario === "retained"; const wires: { body: string; reply: Reply }[] = []; let proxy: Awaited<ReturnType<typeof publicProxy>>;
    const f = await usageCliFixture("restore-" + scenario, async server => { proxy = await publicProxy(server, (req, body, reply) => { if (req.url?.endsWith("/events") && JSON.parse(body.toString()).type === "run.usage" && reply) { wires.push({ body: body.toString(), reply }); if (drop) return { drop: true }; } }, { httpMs: 5000, closeMs: 5000 }); return proxy!.port; });
    try {
      await report(f, "run.started", {}); const backup = f.data + "/backups/usage-" + scenario + ".sqlite";
      if (scenario === "missing") { await f.stop(); expect((await f.command(["backup", "--output", backup], true)).code).toBe(0); await f.start(); }
      await report(f, "run.usage", reportedUsage("restore"), scenario === "retained" ? 2 : 0, f.runId, proxy!.port);
      if (scenario === "retained") { await f.stop(); expect((await f.command(["backup", "--output", backup], true)).code).toBe(0); }
      else { await f.stop(); await report(f, "run.usage", reportedUsage("pending", null, 2), 2); }
      const pending = f.pending()[0], state = f.state(); expect(pending).toBeDefined();
      expect((await f.command(["restore", "--from", backup], true)).code).toBe(0); await f.start(); drop = false;
      const current = (await f.request("/foundation")).generation;
      const result = await flush(f, scenario === "retained" ? 0 : 3, f.runId, proxy!.port);
      expect(wires.at(-1)!.reply.generation).toBe(current);
      if (scenario === "retained") {
        expect(wires.at(-1)!.reply.body).toEqual(wires[0].reply.body); expect(current).not.toBe(wires[0].reply.generation);
        expect(JSON.parse(result.stdout)).toMatchObject({ eventId: JSON.parse(pending.bytes.toString()).body.eventId, acceptedSequence: 2, generation: current });
        expect((await f.summary()).data).toMatchObject({ filteredReportCount: 1, knownTotalTokens: "10" });
      } else {
        expect(result.stderr).toContain("sequence_gap"); expect(result.stderr).toContain('"expectedSequence":2'); expect(f.state()).toEqual(state); expect(f.pending()[0].bytes).toEqual(pending.bytes);
        expect((await f.summary()).data).toMatchObject({ filteredReportCount: 0, knownTotalTokens: "0", runsWithoutReports: 1 });
      }
      await f.stop(); const facts = f.copiedSql("restored"); expect(facts.usage).toHaveLength(scenario === "retained" ? 1 : 0); expect(facts.events).toHaveLength(scenario === "retained" ? 2 : 1);
    } finally { await proxy!.close(); await f.finish({ scenario, wires }); }
  }
}, 90000);
it("rework_and_terminal_replay_preserve_totals", async () => {
  const f = await usageCliFixture("rework");
  try {
    await report(f, "run.started", {});
    const original = JSON.parse((await report(f, "run.usage", reportedUsage("shared", 2, 8))).stdout);
    await report(f, "run.progress", { message: "Synthetic retained payload" });
    await report(f, "run.succeeded", { summary: "Synthetic implementation", artifactRef: "synthetic:usage-v1" });
    const reviewId = await f.run("review"); await report(f, "run.started", {}, 0, reviewId); await report(f, "run.usage", reportedUsage("shared", null, 5), 0, reviewId); await report(f, "run.succeeded", { summary: "Synthetic review observation" }, 0, reviewId);
    let task = (await f.request("/tasks/" + f.taskId)).body.data.task; expect(task.status).toBe("review");
    expect((await f.request("/tasks/" + f.taskId + "/rework", { expectedVersion: task.version, reason: "Synthetic rework" }, true)).status).toBe(200);
    const reworkId = await f.run(); await report(f, "run.started", {}, 0, reworkId); await report(f, "run.usage", reportedUsage("shared", 4, 6), 0, reworkId); await report(f, "run.succeeded", { summary: "Synthetic revised implementation", artifactRef: "synthetic:usage-v2" }, 0, reworkId);
    await f.stop(); const before = f.copiedSql("terminal"); await f.start();
    const historical = before.events.find(e => e.event_id === original.eventId)!;
    const eventBody = { schemaVersion: 1, eventId: original.eventId, runId: f.runId, sequence: 2, type: "run.usage", payload: reportedUsage("shared", 2, 8), occurredAt: "" };
    const matchingRequest = (JSON.parse(historical.acknowledgement) as { data: { eventId: string } }).data; expect(matchingRequest.eventId).toBe(original.eventId);
    const event = (await f.request(`/runs/${f.runId}/events?limit=100`)).body.data.items.find((e: { eventId: string }) => e.eventId === original.eventId);
    Object.assign(eventBody, { occurredAt: event.occurredAt });
    const replay = await f.request(`/runs/${f.runId}/events`, eventBody); expect(replay.status).toBe(200); expect(replay.text).toBe(historical.acknowledgement);
    const fresh = await f.request(`/runs/${f.runId}/events`, { ...eventBody, eventId: randomUUID(), sequence: 5, payload: reportedUsage("new-terminal") }); expect(fresh.status).toBe(409);
    const summary = await f.summary(); expect(summary.data).toMatchObject({ eligibleRuns: 3, runsWithReports: 3, runsWithoutReports: 0, filteredReportCount: 3, knownInputTokens: "6", knownOutputTokens: "19", knownTotalTokens: "20", unknownInputReports: 1, unknownTotalReports: 1 });
    expect(summary.data.runDetails.find(r => r.runId === reworkId)).toMatchObject({ purpose: "implementation", matchingReportCount: 1 });
    const preview = (await f.request("/retention/preview", { cutoff: new Date().toISOString() }, true)).body.data; expect(preview.counts.eventPayloads).toBe(0);
    expect((await f.request("/retention/prune", { previewId: preview.previewId, expectedGeneration: preview.expectedGeneration, expectedVersion: preview.expectedVersion, candidateDigest: preview.candidateDigest }, true)).status).toBe(200);
    expect((await f.summary()).data.knownTotalTokens).toBe("20");
    const foundation = await f.request("/foundation");
    const exported = await fetch(f.server.url + `/api/v1/export?content=attempts&generation=${foundation.generation}`, { headers: { Cookie: await pair(f.server) }, signal: AbortSignal.timeout(10000) });
    expect(exported.status).toBe(200); const lines = (await exported.text()).trim().split("\n").map(row => historyLine.parse(JSON.parse(row)));
    expect(lines[0]).toMatchObject({ kind: "manifest", schemaVersion: 2 }); expect(lines.at(-1)).toMatchObject({ kind: "complete", schemaVersion: 2 });
    const measurements = lines.filter(l => l.kind === "usageMeasurement").map(l => usageMeasurement.parse("data" in l ? l.data : null)); expect(measurements).toHaveLength(3); expect(measurements.find(l => l.runId === reviewId)).toMatchObject({ inputTokens: null, outputTokens: 5, totalTokens: null });
    task = (await f.request("/tasks/" + f.taskId)).body.data.task; expect(task.status).toBe("review");
    await f.stop(); const after = f.copiedSql("protected"); expect(after.tasks[0]).toMatchObject({ status: "review", rework_round: 1 }); expect(after.usage).toEqual(before.usage); expect(after.events.filter(e => e.type === "run.usage")).toEqual(before.events.filter(e => e.type === "run.usage"));
  } finally { await f.finish(); }
}, 60000);
