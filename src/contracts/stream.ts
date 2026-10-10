import { z } from "zod";
import { changeCursor, uuid } from "./common";
export const streamQuery = z.strictObject({ after: changeCursor, generation: uuid });
export const changeNotice = z.strictObject({
  entityType: z.string().min(1).max(100),
  entityId: z.string().min(1).max(100),
  kind: z.string().min(1).max(100),
});
export const changeFrame = z.strictObject({ id: changeCursor, data: changeNotice });
export const resetNotice = z.strictObject({ reason: z.enum(["generation_changed", "cursor_ahead"]), generation: uuid });
export function parseStreamRequest(url: URL, lastEventIds: string[]) {
  const values: Record<string, string> = Object.create(null);
  for (const [key, value] of url.searchParams) {
    if (Object.hasOwn(values, key)) throw new Error("query_invalid");
    values[key] = value;
  }
  const parsed = streamQuery.parse(values);
  if (lastEventIds.length > 1) throw new Error("query_invalid");
  const last = lastEventIds.length ? changeCursor.parse(lastEventIds[0]) : undefined;
  return { ...parsed, after: last ?? parsed.after };
}
