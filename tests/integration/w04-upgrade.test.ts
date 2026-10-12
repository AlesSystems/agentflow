import { expect, it } from "vitest";
import { validateUpgrade } from "../fixtures/w04-upgrade";
it("rejects an upgrade claim missing actual recovery witnesses", () => {
  expect(() => validateUpgrade({ schema: 12, faults: [], sessionsRevoked: 0, retainedPrefixExit: 0, missingPrefixExit: 0, stoppedCopies: 0 })).toThrow();
});
