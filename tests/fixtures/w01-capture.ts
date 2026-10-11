import assert from "node:assert/strict";
export type VisibleIdentity = {
  projectId: string;
  workflowId: string;
  revisionId: string;
  workflowRunId: string;
  nodeId: string;
  eventId: string;
};
export type VisibleCapture = VisibleIdentity & {
  context: number;
  elapsedMs: number;
  frames: number;
  exact: boolean;
  visible: boolean;
  hitTest: boolean;
  matched: number;
  wrong: number;
};
export function distribution(samples: number[]) {
  assert(
    samples.length > 0 && samples.every((n) => Number.isFinite(n) && n >= 0),
    "complete finite samples required",
  );
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    count: samples.length,
    p50Ms: sorted[Math.ceil(sorted.length * 0.5) - 1],
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
    maxMs: sorted.at(-1)!,
    samplesMs: samples,
  };
}
export function summarizeVisibility(
  expected: (VisibleIdentity & { context: number })[],
  captured: VisibleCapture[],
) {
  const key = (v: VisibleIdentity & { context: number }) =>
    `${v.context}:${v.eventId}`;
  const wanted = new Map(expected.map((v) => [key(v), v]));
  assert(
    wanted.size === expected.length,
    "expected denominator contains duplicates",
  );
  const seen = new Map<string, number>();
  let wrong = 0,
    hidden = 0,
    late = 0;
  const exact = new Set<string>(),
    present = new Set<string>();
  for (const v of captured) {
    const k = key(v),
      e = wanted.get(k);
    seen.set(k, (seen.get(k) ?? 0) + 1);
    const bound =
      e &&
      [
        "projectId",
        "workflowId",
        "revisionId",
        "workflowRunId",
        "nodeId",
        "eventId",
      ].every(
        (field) =>
          e[field as keyof VisibleIdentity] ===
          v[field as keyof VisibleIdentity],
      );
    if (bound && v.matched > 0) present.add(k);
    if (!bound || !v.exact || v.wrong > 0) wrong++;
    if (!v.visible || !v.hitTest) hidden++;
    if (v.elapsedMs >= 2000) late++;
    if (
      bound &&
      v.exact &&
      v.visible &&
      v.hitTest &&
      v.frames === 2 &&
      v.matched === 1 &&
      v.wrong === 0
    )
      exact.add(k);
  }
  const missing = expected.filter((v) => !present.has(key(v))).length;
  const unconfirmed = expected.length - exact.size;
  const duplicate =
    [...seen.values()].reduce((n, count) => n + Math.max(0, count - 1), 0) +
    captured.reduce((n, v) => n + Math.max(0, v.matched - 1), 0);
  return {
    expected: expected.length,
    captured: captured.length,
    missing,
    unconfirmed,
    duplicate,
    wrong,
    hidden,
    late,
    valid: unconfirmed === 0 && duplicate === 0 && wrong === 0 && hidden === 0,
    distribution: captured.length
      ? distribution(captured.map((v) => v.elapsedMs))
      : null,
  };
}
// Executed directly in the page. Browser clocks only bound this wait; controller
// elapsed times cover dispatch through completion without clock subtraction.
export async function visibleFrames(input: {
  identity: VisibleIdentity;
  maxWaitMs: number;
}) {
  const e = input.identity,
    until = Date.now() + input.maxWaitMs;
  let frames = 0,
    result = {
      frames: 0,
      frameDeadline: false,
      exact: false,
      visible: false,
      hitTest: false,
      matched: 0,
      wrong: 0,
      observed: [] as Record<string, string | undefined>[],
      otherEventIds: [] as string[],
    };
  do {
    const arrived = await new Promise<boolean>((resolve) => {
      let frame = 0;
      const timer = setTimeout(
        () => {
          cancelAnimationFrame(frame);
          resolve(false);
        },
        Math.max(0, until - Date.now()),
      );
      frame = requestAnimationFrame(() => {
        clearTimeout(timer);
        resolve(true);
      });
    });
    if (!arrived) return { ...result, frameDeadline: true };
    const panels = [
      ...document.querySelectorAll<HTMLElement>(
        ".workflow-evidence[data-event-id]",
      ),
    ].filter((p) => p.dataset.eventId === e.eventId);
    const project =
      location.pathname.split("/")[2]?.toLowerCase() ===
      e.projectId.toLowerCase();
    const bound = panels.filter(
      (p) =>
        project &&
        p.dataset.workflowId === e.workflowId &&
        p.dataset.planRevisionId === e.revisionId &&
        p.dataset.workflowRunId === e.workflowRunId &&
        p.dataset.nodeId === e.nodeId,
    );
    const paragraph = bound[0]
      ? [...bound[0].querySelectorAll<HTMLElement>("p")].find(
          (p) => p.textContent?.trim() === e.eventId,
        )
      : undefined;
    const box = paragraph?.getBoundingClientRect(),
      style = paragraph ? getComputedStyle(paragraph) : undefined;
    const visible =
      !!box &&
      box.width > 0 &&
      box.height > 0 &&
      style?.visibility !== "hidden" &&
      style?.display !== "none" &&
      !!paragraph?.checkVisibility({
        checkOpacity: true,
        checkVisibilityCSS: true,
      }) &&
      box.top >= 0 &&
      box.bottom <= innerHeight &&
      box.left >= 0 &&
      box.right <= innerWidth;
    const hit =
      visible &&
      !!paragraph &&
      !!box &&
      paragraph.contains(
        document.elementFromPoint(
          box.x + box.width / 2,
          box.y + box.height / 2,
        ),
      );
    const exact = bound.length === 1 && panels.length === 1;
    frames = exact && visible && hit ? frames + 1 : 0;
    result = {
      observed: panels.map((p) => ({
        projectId: location.pathname.split("/")[2],
        workflowId: p.dataset.workflowId,
        revisionId: p.dataset.planRevisionId,
        workflowRunId: p.dataset.workflowRunId,
        nodeId: p.dataset.nodeId,
        eventId: p.dataset.eventId,
      })),
      otherEventIds: [
        ...document.querySelectorAll<HTMLElement>(
          ".workflow-evidence[data-event-id]",
        ),
      ]
        .map((p) => p.dataset.eventId ?? "")
        .filter((id) => id !== e.eventId),
      frameDeadline: false,
      frames: Math.min(frames, 2),
      exact,
      visible,
      hitTest: hit,
      matched: panels.length,
      wrong: panels.length - bound.length,
    };
    if (frames === 2) return result;
  } while (Date.now() < until);
  return result;
}
