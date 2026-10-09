import { expect, it } from "vitest";
import { authorize } from "../../src/server/security";
import { equalSecret, sessionCookie } from "../../src/server/auth";
it("reporters cannot authorize human commands", () => {
  expect(() =>
    authorize({ kind: "reporter", id: "reporter" }, "human"),
  ).toThrow("human_required");
});
it("cookies expire and secrets are compared using their hashes", () => {
  expect(sessionCookie("synthetic")).toBe(
    "agentflow_session=synthetic; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200",
  );
  expect(equalSecret("short", "longer")).toBe(false);
});
