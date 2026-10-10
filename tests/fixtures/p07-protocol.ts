import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eventResponse } from "../../src/contracts/observations";
export type Planned = { scenario: number; phase: "sustained" | "burst"; producer: number; dueMs: number; body: { schemaVersion: 1; eventId: string; runId: string; sequence: number; type: "run.heartbeat" | "run.progress"; occurredAt: string; payload: { message?: string } }; message: string | null };
export type Target = { event: Planned; tab: number; dispatchMs: number | null; confirmedMs: number | null; receivedAt: string | null; observedReceipt: string | null; errors: string[]; observation: unknown | null };
export function plan(runs: string[], scenario: number, smoke = false): Planned[] {
  assert.equal(runs.length, smoke ? 2 : 10);
  const sequence = runs.map(() => 1);
  const events: Planned[] = [];
  for (const phase of ["sustained", "burst"] as const) {
    const duration = phase === "sustained" ? (smoke ? 6000 : 300000) : (smoke ? 3000 : 10000);
    const interval = phase === "sustained" ? 500 : 100;
    const markerInterval = phase === "sustained" ? 5000 : 2500;
    for (let dueMs = 0; dueMs < duration; dueMs += interval) {
      for (let producer = 0; producer < runs.length; producer++) {
        const sampled = dueMs % markerInterval === 0 && producer === ((phase === "burst" ? scenario * 4 : 0) + dueMs / markerInterval) % runs.length;
        const eventId = randomUUID(), seq = ++sequence[producer];
        const message = sampled ? `P07 s${scenario} ${phase} p${producer} q${seq} ${eventId}` : null;
        events.push({ scenario, phase, producer, dueMs, message, body: { schemaVersion: 1, eventId, runId: runs[producer], sequence: seq, type: sampled ? "run.progress" : "run.heartbeat", occurredAt: "2026-10-10T00:00:00.000Z", payload: message ? { message } : {} } });
      }
    }
  }
  return events;
}
export function targets(events: Planned[]): Target[] {
  return events.filter(event => event.message).flatMap(event => [0, 1].map(tab => ({ event, tab, dispatchMs: null, confirmedMs: null, receivedAt: null, observedReceipt: null, errors: [], observation: null })));
}
export function acknowledge(raw: unknown, event: Planned) {
  const parsed = eventResponse.parse(raw);
  assert.equal(parsed.data.eventId, event.body.eventId, "ACK_EVENT");
  assert.equal(parsed.data.runId, event.body.runId, "ACK_RUN");
  assert.equal(parsed.data.acceptedSequence, event.body.sequence, "ACK_SEQUENCE");
  return parsed;
}
export function distribution(values: number[]) {
  assert(values.length && values.every(value => Number.isFinite(value) && value >= 0), "INVALID_SAMPLES");
  const sorted = [...values].sort((a,b) => a-b);
  return { count: values.length, p95Ms: sorted[Math.ceil(sorted.length * .95)-1], maxMs: sorted.at(-1)!, samplesMs: values };
}
export function reconcile(rows: Target[], enforceBudget: boolean) {
  const missing = rows.filter(row => row.confirmedMs === null || row.dispatchMs === null || row.receivedAt === null).length;
  const wrong = rows.filter(row => row.observedReceipt !== row.receivedAt || row.errors.length).length;
  assert.equal(missing, 0, "MISSING_TARGET"); assert.equal(wrong, 0, "WRONG_TARGET");
  assert.equal(new Set(rows.map(row => `${row.event.body.eventId}/${row.tab}`)).size, rows.length, "DUPLICATE_TARGET");
  const result = distribution(rows.map(row => row.confirmedMs! - row.dispatchMs!));
  if (enforceBudget) assert(result.p95Ms < 2000, "VISIBILITY_BUDGET");
  return { expected: rows.length, accepted: rows.length, confirmed: rows.length, missing, wrong, duplicate: 0, late: result.samplesMs.filter(ms => ms >= 2000).length, ...result };
}
export function cadence(durationMs: number, intervalMs: number, startedMs: number, endedMs: number, dispatches: { dueMs: number; dispatchMs: number }[]) {
  assert(dispatches.length, "NO_DISPATCHES");
  const elapsed = endedMs - startedMs;
  assert(Math.abs(elapsed-durationMs) <= Math.max(500,durationMs*.01), "STRETCHED_WINDOW");
  assert(dispatches.every(row => row.dispatchMs >= startedMs + row.dueMs && row.dispatchMs - startedMs - row.dueMs < intervalMs), "MISSED_SLOT");
  return { elapsedMs: elapsed, achievedRate: dispatches.length / (elapsed / 1000), lag: distribution(dispatches.map(row => row.dispatchMs-startedMs-row.dueMs)) };
}
