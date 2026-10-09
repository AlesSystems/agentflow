import { z } from "zod";
import { pageQuery, timezone, timestamp, uuid } from "./common";
export const overviewQuery = z.strictObject({
  ...pageQuery,
  timezone: timezone.optional(),
});
export const overview = z.strictObject({
  metrics: z.strictObject({
    activeProjects: z.number().int().nonnegative(),
    reportingAgents: z.number().int().nonnegative(),
    completedToday: z.number().int().nonnegative(),
    awaitingReview: z.number().int().nonnegative(),
    failedRunsToday: z.number().int().nonnegative(),
  }),
  attention: z.strictObject({
    items: z.array(
      z.strictObject({
        id: uuid,
        projectId: uuid,
        taskId: uuid.nullable(),
        runId: uuid.nullable(),
        title: z.string(),
        createdAt: timestamp,
        reasons: z.array(z.enum(["blocked", "failed", "stale"])),
      }),
    ),
    total: z.number().int().nonnegative(),
    nextCursor: z.string().nullable(),
  }),
  timezone,
  capturedAt: timestamp,
  day: z.strictObject({ start: timestamp, end: timestamp }),
});
