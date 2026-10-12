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
