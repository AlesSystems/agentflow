import { expect, it } from "vitest";
import { validateEnvelope, authorize } from "../../src/server/security";
it("rejects ambiguous hosts, origins and same-site private reads", () => {
  expect(() =>
    validateEnvelope(
      { host: "localhost:3456", origin: "http://localhost:3456" },
      3456,
    ),
  ).not.toThrow();
  for (const host of [
    "localhost",
    "localhost:3456.evil",
    "[::1]:3456",
    "evil:3456",
  ])
    expect(() => validateEnvelope({ host }, 3456)).toThrow();
  expect(() =>
    validateEnvelope(
      { host: "localhost:3456", origin: "http://localhost:3457" },
      3456,
    ),
  ).toThrow();
  expect(() =>
    authorize(
      { kind: "browser", id: "operator", sessionId: "synthetic" },
      "read",
      "same-site",
    ),
  ).toThrow();
  expect(() =>
    authorize({ kind: "reporter", id: "reporter" }, "human"),
  ).toThrow();
});
