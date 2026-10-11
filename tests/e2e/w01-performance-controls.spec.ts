import { test, expect } from "@playwright/test";
import { visibleFrames, type VisibleIdentity } from "../fixtures/w01-capture";
const identity: VisibleIdentity = {
  projectId: "11111111-1111-4111-8111-111111111111",
  workflowId: "22222222-2222-4222-8222-222222222222",
  revisionId: "33333333-3333-4333-8333-333333333333",
  workflowRunId: "44444444-4444-4444-8444-444444444444",
  nodeId: "55555555-5555-4555-8555-555555555555",
  eventId: "66666666-6666-4666-8666-666666666666",
};
test("finite visibility helper detects wrong, hidden, absent and duplicate evidence instead of confirming a screenshot-shaped match", async ({
  page,
}) => {
  const panel = (wrong = false, hidden = false) =>
    `<section class="workflow-evidence" data-workflow-id="${identity.workflowId}" data-plan-revision-id="${identity.revisionId}" data-workflow-run-id="${wrong ? identity.nodeId : identity.workflowRunId}" data-node-id="${identity.nodeId}" data-event-id="${identity.eventId}" style="${hidden ? "display:none" : ""}"><p>${identity.eventId}</p></section>`;
  let html = panel();
  await page.route("http://w01.synthetic/**", (route) =>
    route.fulfill({ contentType: "text/html", body: html }),
  );
  const url = `http://w01.synthetic/projects/${identity.projectId}/workflows`;
  for (const kind of ["valid", "wrong", "hidden", "absent", "duplicate"]) {
    html =
      kind === "absent"
        ? "<p>No evidence</p>"
        : kind === "duplicate"
          ? panel() + panel()
          : panel(kind === "wrong", kind === "hidden");
    await page.goto(url);
    const result = await page.evaluate(visibleFrames, {
      identity,
      maxWaitMs: 150,
    });
    console.log(
      JSON.stringify({ acceptance: false, helperControl: kind, result }),
    );
    if (kind === "valid")
      expect(result).toMatchObject({
        frames: 2,
        exact: true,
        visible: true,
        hitTest: true,
        matched: 1,
        wrong: 0,
      });
    else {
      expect(result.frames).toBe(0);
      if (kind === "wrong") expect(result.wrong).toBe(1);
      if (kind === "hidden") expect(result.visible).toBe(false);
      if (kind === "absent") expect(result.matched).toBe(0);
      if (kind === "duplicate") expect(result.matched).toBe(2);
    }
  }
});
