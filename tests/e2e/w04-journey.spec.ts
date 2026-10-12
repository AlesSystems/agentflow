import { test, expect } from "@playwright/test";
import { joinedJourney } from "../fixtures/w04-journey";
test("joined production graph and list journey preserves observer and browser acceptance boundaries", async () => {
  test.setTimeout(300000);
  const result = await joinedJourney("browser");
  expect(result.witness.tabs.map(tab => tab.view)).toEqual(["graph", "list"]);
});
