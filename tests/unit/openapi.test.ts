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
  expect(doc.paths["/api/v1/runs"].post).toBeDefined();
  expect(doc.paths["/api/v1/activity"]).toBeUndefined();
  expect(doc.paths["/api/v1/changes/stream"]).toBeUndefined();
  const event = doc.paths["/api/v1/runs/{id}/events"].post as {
    parameters: { name: string }[];
    responses: Record<string, unknown>;
  };
  expect(event.parameters.map((p) => p.name)).toEqual(["id"]);
  expect(event.responses["200"]).toBeDefined();
  expect(event.responses["201"]).toBeDefined();
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
it("publishes normalized event occurrence strings and generation headers on identity replay", () => {
  const doc = openapiDocument();
  const events = doc.paths["/api/v1/runs/{id}/events"].get as {
    responses: Record<
      string,
      { content?: Record<string, { schema: unknown }> }
    >;
  };
  const output = JSON.stringify(
    events.responses["200"].content!["application/json"].schema,
  );
  expect(output).not.toContain('"occurredAt":{}');
  for (const path of ["/api/v1/runs", "/api/v1/runs/{id}/events"]) {
    const operation = doc.paths[path].post as {
      responses: Record<string, { headers?: Record<string, unknown> }>;
    };
    expect(
      operation.responses["200"].headers?.["AgentFlow-Generation"],
    ).toBeDefined();
  }
});
