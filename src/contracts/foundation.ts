import { z } from "zod";
import { uuid, version } from "./common";
export const foundationSchemas = {
  health: z.strictObject({
    ready: z.literal(true),
    apiVersion: z.literal("v1"),
  }),
  foundation: z.strictObject({
    ready: z.literal(true),
    generation: uuid,
    schemaVersion: version,
  }),
  pairInput: z.strictObject({ token: z.string().max(128) }),
  paired: z.strictObject({ paired: z.literal(true) }),
  revokeInput: z.strictObject({}),
};
