import { expect, it } from "vitest";
import { matchEndpoint } from "../../src/contracts/routes";
it("registers one human-only finite selected export transport", () => {
  const endpoint = matchEndpoint("GET", "/api/v1/export")?.endpoint;
  expect(endpoint?.kind).toBe("export");
  expect(endpoint?.access).toBe("human");
  expect(matchEndpoint("HEAD", "/api/v1/export")?.endpoint).toBe(endpoint);
});
