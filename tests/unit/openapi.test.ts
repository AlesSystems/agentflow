import { expect, it } from "vitest";
import { openapiDocument } from "../../src/contracts/openapi";
import { endpoints } from "../../src/contracts/routes";
import {
  requestExamples,
  responseExamples,
} from "../../src/contracts/examples";
it("publishes every implemented registry operation and validates every example", () => {
  const doc = openapiDocument();
  expect(doc.openapi).toBe("3.1.0");
  for (const endpoint of endpoints) {
    expect(endpoint.input.safeParse(requestExamples[endpoint.id]).success).toBe(
      true,
    );
    expect(
      endpoint.response.safeParse(responseExamples[endpoint.id]).success,
    ).toBe(true);
    expect(
      doc.paths["/api/v1" + endpoint.path][endpoint.method.toLowerCase()],
    ).toBeDefined();
  }
  expect(doc.paths["/api/v1/runs"]).toBeUndefined();
});
it("documents static Next API methods and bodyless foundation exceptions", async () => {
  const { readFileSync } = await import("node:fs");
  const doc = openapiDocument();
  for (const route of ["health", "foundation", "session"]) {
    const source = readFileSync(`src/app/api/v1/${route}/route.ts`, "utf8");
    for (const match of source.matchAll(
      /export (?:async )?function (GET|POST|DELETE|PATCH|HEAD)/g,
    ))
      expect(
        doc.paths["/api/v1/" + route][match[1].toLowerCase()],
      ).toBeDefined();
  }
  expect(doc.paths["/api/v1/health"].head).toBeDefined();
  expect(doc.paths["/api/v1/foundation"].head).toBeDefined();
});
