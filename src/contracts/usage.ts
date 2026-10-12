import { z } from "zod";
import { requiredText, timestamp } from "./common";
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable();
export const usagePayload = z.strictObject({
 usageId: requiredText(200),
 source: requiredText(200),
 model: requiredText(200),
 measuredAt: timestamp.transform(value => new Date(value).toISOString()),
 inputTokens: count,
 outputTokens: count,
 billingBasis: z.enum(["input_output_only", "unrepresented"]).nullable().optional().transform(value => value ?? null),
});
export type UsagePayload = z.infer<typeof usagePayload>;
