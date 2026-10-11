import { expect, it } from "vitest";
import { plan, targets, reconcile, cadence } from "../fixtures/p07-protocol";
it("predeclares every heartbeat slot and compact sampled identity for both tabs", () => {
  const events = plan(Array.from({ length: 10 }, (_, i) => `run-${i}`), 0);
  expect(events).toHaveLength(7000);
});

it("covers all ten burst producers across scenarios without adding reports", () => {
  const runs = Array.from({ length: 10 }, (_, i) => `run-${i}`);
  const scenarios = [0,1,2].map(i => plan(runs,i));
  expect(scenarios.map(events => targets(events).length)).toEqual([128,128,128]);
  expect(new Set(scenarios.flat().filter(e => e.phase === "burst" && e.message).map(e => e.producer)).size).toBe(10);
  expect(scenarios[0].filter(e => e.phase === "sustained" && e.message)).toHaveLength(60);
  expect(scenarios.flat().filter(e => e.message).every(e => e.message!.length < 320)).toBe(true);
});
it("refuses missing, wrong receipt, duplicate and backwards-clock targets", () => {
  const row = targets(plan(["a","b"],0,true))[0];
  expect(() => reconcile([row],false)).toThrow("MISSING_TARGET");
  Object.assign(row,{dispatchMs:10,confirmedMs:20,receivedAt:"receipt",observedReceipt:"wrong"});
  expect(() => reconcile([row],false)).toThrow("WRONG_TARGET");
  row.observedReceipt="receipt";
  expect(reconcile([row],false)).toMatchObject({expected:1,confirmed:1,p95Ms:10});
  expect(() => reconcile([row,row],false)).toThrow("DUPLICATE_TARGET");
  row.confirmedMs=9;
  expect(() => reconcile([row],false)).toThrow("INVALID_SAMPLES");
});
it("refuses stretched or missed cadence even with complete report counts", () => {
  expect(cadence(1000,100,10,1010,[{dueMs:0,dispatchMs:10}])).toMatchObject({elapsedMs:1000});
  expect(() => cadence(1000,100,10,2010,[{dueMs:0,dispatchMs:10}])).toThrow("STRETCHED_WINDOW");
  expect(() => cadence(1000,100,10,1010,[{dueMs:0,dispatchMs:111}])).toThrow("MISSED_SLOT");
});
