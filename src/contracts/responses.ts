import { z } from "zod";
import { envelope, status } from "./common";
import { project } from "./projects";
import { task, taskDetailV1, comment, completion } from "./tasks";
import { settings } from "./settings";
import { overview } from "./overview";
export const list = <T extends z.ZodType>(item: T) =>
  z.strictObject({
    items: z.array(item),
    total: z.number().int().nonnegative(),
    nextCursor: z.string().nullable(),
  });
export const projectsResponse = envelope(list(project));
export const projectResponse = envelope(project);
export const tasksResponse = envelope(list(task));
export const taskResponse = envelope(task);
export const taskDetailResponse = envelope(taskDetailV1);
export const commentsResponse = envelope(list(comment));
export const commentResponse = envelope(comment);
export const completionResponse = envelope(completion);
export const settingsResponse = envelope(settings);
export const overviewResponse = envelope(overview);
export const boardResponse = envelope(
  z.strictObject({
    columns: z.array(z.strictObject({ status, ...list(task).shape })),
  }),
);
