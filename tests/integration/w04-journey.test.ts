import { expect, it } from "vitest";
import { validateJourney, type JourneyWitness } from "../fixtures/w04-journey";
const complete: JourneyWitness = {
  cli: [{ exitCode: 0, closed: true }],
  tabs: [{ independentlyPaired: true, view: "graph", nodeRunId: "same-attempt" }, { independentlyPaired: true, view: "list", nodeRunId: "same-attempt" }],
  workflow: { revisions: ["old", "new"], immutableHistory: true },
  retention: { priorGeneration: "old", generation: "new", exactReplay: true },
  audit: { stopped: true, copied: true, foreignKeys: [] },
};
it("joined proof rejects incomplete actual-boundary evidence", () => {
  expect(() => validateJourney(complete)).not.toThrow();
  for (const witness of [
    { ...complete, cli: [{ exitCode: null, closed: false }] },
    { ...complete, tabs: [complete.tabs[0]] },
    { ...complete, tabs: complete.tabs.map(tab => ({ ...tab, independentlyPaired: false })) },
    { ...complete, workflow: { revisions: ["old"], immutableHistory: false } },
    { ...complete, retention: { ...complete.retention, generation: "old", exactReplay: false } },
    { ...complete, audit: { stopped: false, copied: false, foreignKeys: [{ violation: true }] } },
  ]) expect(() => validateJourney(witness)).toThrow();
});

it("one joined compiled production CLI HTTP two-browser journey persists across prune and restart", async () => {
  const { joinedJourney } = await import("../fixtures/w04-journey");
  const result = await joinedJourney("integration");
  expect(result.witness.tabs.map(tab => tab.nodeRunId)).toEqual([result.witness.tabs[0].nodeRunId, result.witness.tabs[0].nodeRunId]);
}, 300000);
