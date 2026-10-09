import { expect, test } from "vitest";
import { ApiClient, StaleSnapshot } from "../../src/client/api";
import { z } from "zod";
import { moveIntent, freezeCommand } from "../../src/client/commands";
const schema = z.object({
  generation: z.string(),
  data: z.object({ version: z.number() }),
});
test("late old-generation reads and historical receipts cannot become current snapshots", async () => {
  let finish!: (value: Response) => void;
  let calls = 0;
  const api = new ApiClient(
    "old",
    () => {},
    async () => {
      if (++calls === 1)
        return new Promise<Response>((resolve) => {
          finish = resolve;
        });
      return Response.json(
        { generation: "old", data: { version: 1 } },
        { headers: { "AgentFlow-Generation": "new" } },
      );
    },
  );
  const pending = api.read("/tasks", schema);
  await expect(api.read("/tasks", schema)).rejects.toBeInstanceOf(
    StaleSnapshot,
  );
  finish(
    Response.json(
      { generation: "old", data: { version: 2 } },
      { headers: { "AgentFlow-Generation": "old" } },
    ),
  );
  await expect(pending).rejects.toBeInstanceOf(StaleSnapshot);
  expect(api.generation).toBe("new");
});
test("Completed is acceptance only from Review and same-lane movement is inert", () => {
  expect(moveIntent("review", "completed")).toEqual({ kind: "accept" });
  expect(moveIntent("backlog", "completed")).toEqual({ kind: "reviewFirst" });
  expect(moveIntent("backlog", "backlog")).toEqual({ kind: "none" });
  expect(moveIntent("backlog", "review")).toEqual({
    kind: "patch",
    status: "review",
  });
});
test("an uncertain retry retains the exact request and key", () => {
  const body = { title: "Kept draft", expectedVersion: 3 };
  const command = freezeCommand("/tasks/id", "PATCH", body);
  body.title = "Changed later";
  expect(command.body).toBe('{"title":"Kept draft","expectedVersion":3}');
  expect(command.key).toMatch(/^[a-f0-9-]{36}$/);
});
