import assert from "node:assert/strict";
export type JourneyWitness = {
  cli: { exitCode: number | null; closed: boolean }[];
  tabs: { independentlyPaired: boolean; view: "graph" | "list"; nodeRunId: string }[];
  workflow: { revisions: string[]; immutableHistory: boolean };
  retention: { priorGeneration: string; generation: string; exactReplay: boolean };
  audit: { stopped: boolean; copied: boolean; foreignKeys: unknown[] };
};
export function validateJourney(witness: JourneyWitness) {
  assert(witness.cli.length > 0, "actual CLI required");
}
