import { expect, it } from "vitest";
import { plan } from "../fixtures/p07-protocol";
it("predeclares every heartbeat slot and compact sampled identity for both tabs", () => {
  const events = plan(Array.from({ length: 10 }, (_, i) => `run-${i}`), 0);
  expect(events).toHaveLength(7000);
});
