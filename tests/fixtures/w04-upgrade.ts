import assert from "node:assert/strict";
export type UpgradeWitness = { schema: number; faults: string[]; sessionsRevoked: number; retainedPrefixExit: number; missingPrefixExit: number; stoppedCopies: number };
export function validateUpgrade(witness: UpgradeWitness) {
  assert.equal(witness.schema, 12);
}
