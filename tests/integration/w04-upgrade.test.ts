import { expect, it } from "vitest";
import { validateUpgrade, upgradeJourney } from "../fixtures/w04-upgrade";
it("rejects an upgrade claim missing actual recovery witnesses", () => {
  expect(() => validateUpgrade({ schema: 12, faults: [], sessionsRevoked: 0, retainedPrefixExit: 0, missingPrefixExit: 0, stoppedCopies: 0 })).toThrow();
  expect(() => validateUpgrade({ schema: 12, faults: ["workflows", "copy", "drop"], sessionsRevoked: 2, retainedPrefixExit: 0, missingPrefixExit: 3, stoppedCopies: 10 })).not.toThrow();
});
it("preserves actual Phase2 facts through staged production upgrade, faults, stopped restore and outbox repair boundaries", async () => {
  const result = await upgradeJourney();
  expect(result.witness).toMatchObject({ schema: 12, sessionsRevoked: 2, retainedPrefixExit: 0, missingPrefixExit: 3 });
}, 300000);
